import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { workspaceService } from '../src/services/workspaceService.js';

describe('Workspace Registration & Service', () => {
  const testDir = path.join(os.tmpdir(), `minfy-ws-test-${Date.now()}`);

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('registers a valid directory as workspace', async () => {
    const ws = await workspaceService.registerWorkspace(testDir);
    assert.ok(ws.id, 'Workspace ID should exist');
    assert.strictEqual(ws.rootPath, path.resolve(testDir));
    assert.strictEqual(ws.name, path.basename(testDir));
    assert.ok(ws.openedAt, 'openedAt timestamp should exist');
  });

  test('retrieves registered workspace by id', async () => {
    const ws = await workspaceService.registerWorkspace(testDir);
    const retrieved = workspaceService.getWorkspace(ws.id);
    assert.deepStrictEqual(retrieved, ws);
  });

  test('rejects non-existent directory', async () => {
    const fakeDir = path.join(os.tmpdir(), 'non-existent-dir-12345');
    await assert.rejects(
      async () => {
        await workspaceService.registerWorkspace(fakeDir);
      },
      /Directory does not exist/
    );
  });
});
