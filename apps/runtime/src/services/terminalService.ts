import { spawn, ChildProcess } from 'node:child_process';
import os from 'node:os';
import { WebSocket } from 'ws';
import { TerminalClientMessage, TerminalServerMessage } from '@minfy/shared';
import { workspaceService } from './workspaceService.js';

interface TerminalSession {
  id: string;
  workspaceId: string;
  process: ChildProcess;
  ws: WebSocket;
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
    const isWindows = os.platform() === 'win32';

    // Select default shell
    let shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    let args: string[] = [];

    if (isWindows) {
      args = ['-NoLogo'];
    }

    let proc: ChildProcess;
    try {
      proc = spawn(shell, args, {
        cwd: workspace.rootPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      this.send(ws, { type: 'error', error: `Failed to spawn shell: ${err.message}` });
      ws.close(1011, 'Shell spawn failed');
      return;
    }

    const session: TerminalSession = {
      id: sessionId,
      workspaceId,
      process: proc,
      ws,
    };
    this.sessions.set(sessionId, session);

    // Initial greeting banner (subtle, clean)
    this.send(ws, {
      type: 'output',
      data: `\x1b[1;34m[Minfy Terminal]\x1b[0m Workspace: \x1b[33m${workspace.name}\x1b[0m\r\n\x1b[90mDirectory: ${workspace.rootPath}\x1b[0m\r\n\r\n`,
    });

    // Stream process stdout to client
    proc.stdout?.on('data', (chunk: Buffer) => {
      this.send(ws, {
        type: 'output',
        data: chunk.toString('utf-8'),
      });
    });

    // Stream process stderr to client
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.send(ws, {
        type: 'output',
        data: chunk.toString('utf-8'),
      });
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      this.send(ws, {
        type: 'exit',
        exitCode: code ?? 0,
      });
      this.sessions.delete(sessionId);
    });

    proc.on('error', (err) => {
      this.send(ws, {
        type: 'error',
        error: `Process error: ${err.message}`,
      });
    });

    // Handle incoming client messages
    ws.on('message', (rawData: string | Buffer) => {
      try {
        const msg: TerminalClientMessage = JSON.parse(rawData.toString());
        if (msg.type === 'input' && msg.data) {
          if (proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.write(msg.data);
          }
        } else if (msg.type === 'ping') {
          this.send(ws, { type: 'pong' });
        }
      } catch (err) {
        console.error('Failed to parse terminal client message:', err);
      }
    });

    // Cleanup on WS close
    ws.on('close', () => {
      this.cleanupSession(sessionId);
    });

    ws.on('error', () => {
      this.cleanupSession(sessionId);
    });
  }

  private cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        if (!session.process.killed) {
          session.process.kill();
        }
      } catch (err) {
        console.error(`Error killing terminal process ${sessionId}:`, err);
      }
      this.sessions.delete(sessionId);
    }
  }

  private send(ws: WebSocket, message: TerminalServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export const terminalService = new TerminalService();
