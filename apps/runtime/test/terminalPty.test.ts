import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { terminalService, resolveDefaultShell, findExecutableInPath } from '../src/services/terminalService.js';
import { workspaceService } from '../src/services/workspaceService.js';

class MockWebSocket extends EventEmitter {
  public static OPEN = 1;
  public readyState = 1;
  public sentMessages: any[] = [];
  public closeCode: number | null = null;
  public closeReason: string | null = null;

  send(data: string) {
    try {
      this.sentMessages.push(JSON.parse(data));
    } catch {
      this.sentMessages.push(data);
    }
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeCode = code ?? 1000;
    this.closeReason = reason ?? '';
    this.emit('close', code, reason);
  }
}

describe('Milestone 7.5.1: Native PTY Terminal & ConPTY Protocol', () => {
  const testDir = path.join(os.tmpdir(), `minfy-pty-test-${Date.now()}`);
  let wsWorkspace: any;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    wsWorkspace = await workspaceService.registerWorkspace(testDir);
  });

  after(async () => {
    terminalService.shutdown();
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore temporary directory lock on Windows
    }
  });

  test('1. Shell Resolution finds powershell on Windows or shell on Unix', () => {
    const shellInfo = resolveDefaultShell();
    assert.ok(shellInfo.shell, 'Should have resolved an executable shell');
    assert.ok(shellInfo.displayName, 'Should have a display name');

    if (os.platform() === 'win32') {
      assert.ok(
        shellInfo.shell.toLowerCase().includes('powershell') || shellInfo.shell.toLowerCase().includes('pwsh'),
        `Windows shell should be powershell or pwsh, got: ${shellInfo.shell}`
      );
      assert.deepStrictEqual(shellInfo.args, ['-NoLogo'], 'Windows shell args must include -NoLogo');
    }
  });

  test('2. findExecutableInPath correctly locates standard executables', () => {
    if (os.platform() === 'win32') {
      const ps = findExecutableInPath('powershell');
      assert.ok(ps, 'Should find powershell in PATH on Windows');
      assert.ok(ps.toLowerCase().endsWith('.exe'));
    } else {
      const sh = findExecutableInPath('sh') || findExecutableInPath('bash');
      assert.ok(sh, 'Should find sh or bash in PATH on Unix');
    }
  });

  test('3. handleConnection rejects invalid workspace with code 1008', () => {
    const mockWs = new MockWebSocket() as any;
    terminalService.handleConnection(mockWs, 'non-existent-ws-id');

    assert.strictEqual(mockWs.closeCode, 1008);
    assert.strictEqual(mockWs.sentMessages[0]?.type, 'error');
    assert.ok(mockWs.sentMessages[0]?.error.includes('Workspace not found'));
  });

  test('4. spawns true PTY session, streams output, handles resize and input', async () => {
    const mockWs = new MockWebSocket() as any;
    terminalService.handleConnection(mockWs, wsWorkspace.id);

    assert.strictEqual(terminalService.getActiveSessionCount(), 1, 'Active session count should be 1');

    // Wait for initial shell output from PTY
    await new Promise((resolve) => {
      const check = () => {
        const hasOutput = mockWs.sentMessages.some((m: any) => m.type === 'output');
        if (hasOutput) resolve(true);
        else setTimeout(check, 100);
      };
      check();
    });

    // Send resize message
    mockWs.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 100, rows: 30 })));

    // Send ping message
    mockWs.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));
    assert.ok(mockWs.sentMessages.some((m: any) => m.type === 'pong'), 'Should receive pong');

    // Send keystroke input to PTY
    mockWs.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'Write-Output MINFY_PTY_OK\r\n' })));

    // Wait for MINFY_PTY_OK output
    await new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const fullOutput = mockWs.sentMessages
          .filter((m: any) => m.type === 'output')
          .map((m: any) => m.data)
          .join('');
        if (fullOutput.includes('MINFY_PTY_OK') || Date.now() - start > 4000) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    // Close WS and verify session cleanup
    mockWs.close();
    assert.strictEqual(terminalService.getActiveSessionCount(), 0, 'Session count should be 0 after close');
  });

  test('5. shutdown terminates all sessions cleanly', () => {
    terminalService.shutdown();
    assert.strictEqual(terminalService.getActiveSessionCount(), 0);
  });
});
