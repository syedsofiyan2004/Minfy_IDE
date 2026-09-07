import * as pty from 'node-pty';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { TerminalClientMessage, TerminalServerMessage } from '@minfy/shared';
import { workspaceService } from './workspaceService.js';

interface TerminalSession {
  id: string;
  workspaceId: string;
  ptyProcess: pty.IPty;
  ws: WebSocket;
}

export function findExecutableInPath(name: string): string | null {
  const isWindows = os.platform() === 'win32';
  const pathEnv = process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(path.delimiter);
  const extensions = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
      const fullPath = path.join(dir, candidate);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          return fullPath;
        }
      } catch {
        // Ignore permission or file access errors
      }
    }
  }
  return null;
}

export function resolveDefaultShell(): { shell: string; args: string[]; displayName: string } {
  const isWindows = os.platform() === 'win32';
  if (!isWindows) {
    const shell = process.env.SHELL || '/bin/bash';
    return { shell, args: [], displayName: path.basename(shell) };
  }

  // Windows Shell Resolution Order:
  // 1. pwsh.exe if installed (PowerShell 7+)
  const pwshPath = findExecutableInPath('pwsh') ||
    (fs.existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe') ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : null);

  if (pwshPath) {
    return { shell: pwshPath, args: ['-NoLogo'], displayName: 'PowerShell 7' };
  }

  // 2. powershell.exe (Windows PowerShell)
  const powershellPath = findExecutableInPath('powershell') ||
    (fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      : null);

  if (powershellPath) {
    return { shell: powershellPath, args: ['-NoLogo'], displayName: 'PowerShell' };
  }

  // 3. Fallback: neither exists -> throw diagnostic error
  throw new Error(
    'Neither pwsh.exe nor powershell.exe could be located on this system. Please ensure PowerShell is installed and present in PATH.'
  );
}

export class TerminalService {
  private sessions: Map<string, TerminalSession> = new Map();

  public handleConnection(ws: WebSocket, workspaceId: string) {
    const workspace = workspaceService.getWorkspace(workspaceId);
    if (!workspace) {
      this.send(ws, { type: 'error', error: `Workspace not found: ${workspaceId}` });
      ws.close(1008, 'Workspace not found');
      return;
    }

    const sessionId = `${workspaceId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    let shellInfo: { shell: string; args: string[]; displayName: string };
    try {
      shellInfo = resolveDefaultShell();
    } catch (err: any) {
      this.send(ws, { type: 'error', error: err.message });
      ws.close(1011, 'Shell resolution failed');
      return;
    }

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shellInfo.shell, shellInfo.args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: workspace.rootPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
        useConpty: os.platform() === 'win32',
      });
    } catch (err: any) {
      this.send(ws, { type: 'error', error: `Failed to spawn pseudo-terminal: ${err.message}` });
      ws.close(1011, 'PTY spawn failed');
      return;
    }

    const session: TerminalSession = {
      id: sessionId,
      workspaceId,
      ptyProcess,
      ws,
    };
    this.sessions.set(sessionId, session);

    // Stream raw PTY output to client WebSocket
    ptyProcess.onData((data: string) => {
      this.send(ws, {
        type: 'output',
        data,
      });
    });

    // Handle PTY process exit
    ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
      this.send(ws, {
        type: 'exit',
        exitCode: e.exitCode,
      });
      this.sessions.delete(sessionId);
    });

    // Handle incoming client messages
    ws.on('message', (rawData: string | Buffer) => {
      try {
        const msg: TerminalClientMessage = JSON.parse(rawData.toString());
        if (msg.type === 'input' && typeof msg.data === 'string') {
          ptyProcess.write(msg.data);
        } else if (msg.type === 'resize') {
          const cols = typeof msg.cols === 'number' ? msg.cols : 80;
          const rows = typeof msg.rows === 'number' ? msg.rows : 24;
          if (cols > 0 && cols <= 500 && rows > 0 && rows <= 200) {
            try {
              ptyProcess.resize(cols, rows);
            } catch (err) {
              console.warn(`PTY resize error on session ${sessionId}:`, err);
            }
          }
        } else if (msg.type === 'ping') {
          this.send(ws, { type: 'pong' });
        }
      } catch (err) {
        console.error('Failed to parse terminal client message:', err);
      }
    });

    // Cleanup on WS close or error
    ws.on('close', () => {
      this.cleanupSession(sessionId);
    });

    ws.on('error', () => {
      this.cleanupSession(sessionId);
    });
  }

  public cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.ptyProcess.kill();
      } catch (err) {
        console.error(`Error killing terminal PTY process ${sessionId}:`, err);
      }
      this.sessions.delete(sessionId);
    }
  }

  public shutdown() {
    for (const [id, session] of this.sessions.entries()) {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }

  public getActiveSessionCount(): number {
    return this.sessions.size;
  }

  private send(ws: WebSocket, message: TerminalServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export const terminalService = new TerminalService();
