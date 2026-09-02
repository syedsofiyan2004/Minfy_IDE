import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { workspaceService } from '../src/services/workspaceService.js';

describe('Terminal Execution in Workspace Root', () => {
  const testDir = path.join(os.tmpdir(), `minfy-term-test-${Date.now()}`);
  let ws: any;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    ws = await workspaceService.registerWorkspace(testDir);
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('spawns shell process in the correct workspace directory', (t, done) => {
    const isWindows = os.platform() === 'win32';
    const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const args = isWindows ? ['-NoLogo', '-Command', 'Get-Location'] : ['-c', 'pwd'];

    const proc = spawn(shell, args, {
      cwd: ws.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      assert.strictEqual(code, 0);
      // Verify that output contains canonical testDir path
      const canonical = path.resolve(testDir).toLowerCase();
      assert.ok(
        stdout.toLowerCase().includes(canonical) || stdout.toLowerCase().includes(path.basename(canonical)),
        `Output "${stdout}" should reflect workspace cwd "${canonical}"`
      );
      done();
    });
  });
});
