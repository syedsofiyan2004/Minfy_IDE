import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveSafeWorkspacePath, SecurityError } from '../src/security/pathGuard.js';
import { fileService } from '../src/services/fileService.js';
import { workspaceService } from '../src/services/workspaceService.js';

describe('Security & Path Traversal Guardrails', () => {
  const root = path.join(os.tmpdir(), `minfy-security-test-${Date.now()}`);
  const outside = path.join(os.tmpdir(), `minfy-outside-test-${Date.now()}`);
  let ws: any;
  let symlinksSupported = false;

  before(async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(path.join(root, 'packages', 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'packages', 'src', 'inside.ts'), 'inside content', 'utf-8');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'super secret', 'utf-8');

    ws = await workspaceService.registerWorkspace(root);

    // Try creating a test symlink to check OS support/permissions
    try {
      const testSymlinkPath = path.join(root, 'test-symlink');
      await fs.symlink(path.join(root, 'packages', 'src'), testSymlinkPath, 'junction');
      await fs.unlink(testSymlinkPath);
      symlinksSupported = true;
    } catch {
      symlinksSupported = false;
    }
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  test('resolves safe relative path correctly', () => {
    const res = resolveSafeWorkspacePath(root, 'packages/src/inside.ts');
    assert.strictEqual(res.absolutePath, path.join(root, 'packages', 'src', 'inside.ts'));
    assert.strictEqual(res.relativePath, 'packages/src/inside.ts');
  });

  test('resolves root itself when subPath is empty', () => {
    const res = resolveSafeWorkspacePath(root, '');
    assert.strictEqual(res.absolutePath, path.resolve(root));
    assert.strictEqual(res.relativePath, '');
  });

  test('blocks dot-dot (..) traversal escaping root', () => {
    assert.throws(() => {
      resolveSafeWorkspacePath(root, '../../etc/passwd');
    }, SecurityError);

    assert.throws(() => {
      resolveSafeWorkspacePath(root, 'packages/../../..');
    }, SecurityError);

    assert.throws(() => {
      resolveSafeWorkspacePath(root, '../other-folder');
    }, SecurityError);
  });

  test('blocks null bytes in paths', () => {
    assert.throws(() => {
      resolveSafeWorkspacePath(root, 'packages/src/inside.ts\0.png');
    }, SecurityError);
  });

  test('blocks absolute path escaping workspace root', () => {
    const outsideTarget = os.platform() === 'win32' ? 'C:\\Windows\\System32' : '/etc/shadow';
    assert.throws(() => {
      resolveSafeWorkspacePath(root, outsideTarget);
    }, SecurityError);
  });

  test('allows absolute path if it is genuinely inside workspace root', () => {
    const insidePath = path.join(root, 'packages', 'src', 'inside.ts');
    const res = resolveSafeWorkspacePath(root, insidePath);
    assert.strictEqual(res.absolutePath, insidePath);
    assert.strictEqual(res.relativePath, 'packages/src/inside.ts');
  });

  test('blocks root deletion attempt', async () => {
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

  test('symlink resolving inside workspace is allowed', async (t) => {
    if (!symlinksSupported) {
      t.skip('Symlinks not supported in current environment/permissions');
      return;
    }

    const insideLink = path.join(root, 'inside-link');
    try {
      await fs.symlink(path.join(root, 'packages', 'src'), insideLink, 'junction');
      const res = resolveSafeWorkspacePath(root, 'inside-link/inside.ts');
      assert.ok(res.absolutePath);

      const fileRes = await fileService.readFile(ws, 'inside-link/inside.ts');
      assert.strictEqual(fileRes.content, 'inside content');
    } finally {
      try { await fs.unlink(insideLink); } catch {}
    }
  });

  test('symlink resolving outside workspace is blocked on read and save', async (t) => {
    if (!symlinksSupported) {
      t.skip('Symlinks not supported in current environment/permissions');
      return;
    }

    const outsideLink = path.join(root, 'outside-link');
    try {
      await fs.symlink(outside, outsideLink, 'junction');

      assert.throws(() => {
        resolveSafeWorkspacePath(root, 'outside-link/secret.txt');
      }, SecurityError);

      await assert.rejects(
        async () => {
          await fileService.readFile(ws, 'outside-link/secret.txt');
        },
        SecurityError
      );

      await assert.rejects(
        async () => {
          await fileService.saveFile(ws, 'outside-link/hack.txt', 'danger');
        },
        SecurityError
      );
    } finally {
      try { await fs.unlink(outsideLink); } catch {}
    }
  });

  test('create operation through external symlinked parent is blocked', async (t) => {
    if (!symlinksSupported) {
      t.skip('Symlinks not supported in current environment/permissions');
      return;
    }

    const outsideLink = path.join(root, 'outside-parent');
    try {
      await fs.symlink(outside, outsideLink, 'junction');

      await assert.rejects(
        async () => {
          await fileService.createEntry(ws, 'outside-parent/new-file.txt', 'file', 'content');
        },
        SecurityError
      );
    } finally {
      try { await fs.unlink(outsideLink); } catch {}
    }
  });
});
