import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { workspaceService } from '../src/services/workspaceService.js';
import { fileService } from '../src/services/fileService.js';
import { SecurityError } from '../src/security/pathGuard.js';

describe('File Operations & Content Inspection', () => {
  const testDir = path.join(os.tmpdir(), `minfy-file-test-${Date.now()}`);
  let ws: any;

  before(async () => {
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'app.ts'), 'console.log("hello world");\n', 'utf-8');
    await fs.writeFile(path.join(testDir, 'README.md'), '# Test Project\n', 'utf-8');
    // Binary file (contains null byte)
    const binBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]);
    await fs.writeFile(path.join(testDir, 'image.png'), binBuffer);

    ws = await workspaceService.registerWorkspace(testDir);
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('lists workspace root with directories first', async () => {
    const items = await fileService.listTree(ws, '');
    assert.ok(items.length >= 3);
    assert.strictEqual(items[0].type, 'directory');
    assert.strictEqual(items[0].name, 'src');
    assert.strictEqual(items[0].hasChildren, true);
  });

  test('lists subdirectory lazily', async () => {
    const items = await fileService.listTree(ws, 'src');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'app.ts');
    assert.strictEqual(items[0].type, 'file');
  });

  test('reads text file content accurately', async () => {
    const result = await fileService.readFile(ws, 'README.md');
    assert.strictEqual(result.isBinary, false);
    assert.strictEqual(result.encoding, 'utf-8');
    assert.strictEqual(result.content, '# Test Project\n');
  });

  test('detects binary file and does not return utf-8 content', async () => {
    const result = await fileService.readFile(ws, 'image.png');
    assert.strictEqual(result.isBinary, true);
    assert.strictEqual(result.content, undefined);
  });

  test('saves changes to file and updates disk content', async () => {
    const newContent = 'export const version = "1.0.0";\n';
    const saveRes = await fileService.saveFile(ws, 'src/version.ts', newContent);
    assert.strictEqual(saveRes.saved, true);

    const readRes = await fileService.readFile(ws, 'src/version.ts');
    assert.strictEqual(readRes.content, newContent);
  });

  test('creates new file and folder successfully', async () => {
    const dirNode = await fileService.createEntry(ws, 'docs', 'directory');
    assert.strictEqual(dirNode.type, 'directory');
    assert.strictEqual(dirNode.name, 'docs');

    const fileNode = await fileService.createEntry(ws, 'docs/notes.txt', 'file', 'Initial notes');
    assert.strictEqual(fileNode.type, 'file');

    const readRes = await fileService.readFile(ws, 'docs/notes.txt');
    assert.strictEqual(readRes.content, 'Initial notes');
  });

  test('blocks path traversal when attempting to read or save outside root', async () => {
    await assert.rejects(
      async () => {
        await fileService.readFile(ws, '../../secret.txt');
      },
      SecurityError
    );

    await assert.rejects(
      async () => {
        await fileService.saveFile(ws, '../hacked.txt', 'evil');
      },
      SecurityError
    );
  });

  test('deletes files and subdirectories correctly', async () => {
    await fileService.createEntry(ws, 'temp.txt', 'file', 'to delete');
    await fileService.deleteEntry(ws, 'temp.txt');
    await assert.rejects(
      async () => {
        await fileService.readFile(ws, 'temp.txt');
      },
      /ENOENT/
    );
  });

  test('strictly forbids deleting the workspace root', async () => {
    await assert.rejects(
      async () => {
        await fileService.deleteEntry(ws, '');
      },
      SecurityError
    );

    await assert.rejects(
      async () => {
        await fileService.deleteEntry(ws, '.');
      },
      SecurityError
    );
  });
});
