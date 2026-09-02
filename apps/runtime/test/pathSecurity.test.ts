import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveSafeWorkspacePath } from '../src/security/pathGuard.js';
import { fileService } from '../src/services/fileService.js';
import { Workspace } from '@minfy/shared';

describe('Path & Workspace Security Guardrails', () => {
  const tmpDir = path.join(os.tmpdir(), `minfy-path-sec-test-${Date.now()}`);
  const outsideDir = path.join(os.tmpdir(), `minfy-outside-sec-test-${Date.now()}`);
  let wsFixture: Workspace;

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    // Populate inside workspace
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'Hello safe workspace');
    fs.mkdirSync(path.join(tmpDir, 'subfolder'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'subfolder', 'file2.txt'), 'Hello subfolder');

    // Populate outside workspace
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'SUPER_SECRET_TOKEN');

    wsFixture = {
      id: 'ws-sec-test',
      name: 'ws-sec-test',
      rootPath: tmpDir,
      createdAt: new Date().toISOString(),
    };
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {}
  });

  test('resolves safe relative path correctly', () => {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(tmpDir, 'subfolder/file2.txt');
    assert.strictEqual(path.normalize(absolutePath), path.normalize(path.join(tmpDir, 'subfolder', 'file2.txt')));
    assert.strictEqual(relativePath, 'subfolder/file2.txt');
  });

  test('resolves root itself when subPath is empty', () => {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(tmpDir, '');
    assert.strictEqual(path.normalize(absolutePath), path.normalize(tmpDir));
    assert.strictEqual(relativePath, '');
  });

  test('blocks dot-dot (..) traversal escaping root', () => {
    assert.throws(
      () => resolveSafeWorkspacePath(tmpDir, '../../etc/passwd'),
      /resolves outside the current workspace/i
    );
    assert.throws(
      () => resolveSafeWorkspacePath(tmpDir, 'subfolder/../../secret.txt'),
      /resolves outside the current workspace/i
    );
  });

  test('blocks null bytes in paths', () => {
    assert.throws(
      () => resolveSafeWorkspacePath(tmpDir, 'file1.txt\0.png'),
      /null bytes are not permitted/i
    );
  });

  test('blocks absolute path escaping workspace root', () => {
    assert.throws(
      () => resolveSafeWorkspacePath(tmpDir, path.join(outsideDir, 'secret.txt')),
      /resolves outside the current workspace/i
    );
  });

  test('allows absolute path if it is genuinely inside workspace root', () => {
    const absPath = path.join(tmpDir, 'subfolder', 'file2.txt');
    const { absolutePath } = resolveSafeWorkspacePath(tmpDir, absPath);
    assert.strictEqual(path.normalize(absolutePath), path.normalize(absPath));
  });

  test('blocks root deletion attempt', async () => {
    await assert.rejects(
      () => fileService.deleteEntry(wsFixture, ''),
      /cannot delete workspace root/i
    );
  });

  test('symlink resolving inside workspace is allowed', () => {
    const linkPath = path.join(tmpDir, 'link_internal.txt');
    try {
      fs.symlinkSync(path.join(tmpDir, 'file1.txt'), linkPath);
    } catch (e) {
      // If OS environment requires elevated privileges for symlinks (e.g. Windows Developer Mode disabled), skip cleanly
      return;
    }

    const { absolutePath } = resolveSafeWorkspacePath(tmpDir, 'link_internal.txt');
    assert.ok(absolutePath);
  });

  test('symlink resolving outside workspace is blocked on read and save', async () => {
    const linkPath = path.join(tmpDir, 'link_escape.txt');
    try {
      fs.symlinkSync(path.join(outsideDir, 'secret.txt'), linkPath);
    } catch (e) {
      return;
    }

    assert.throws(
      () => resolveSafeWorkspacePath(tmpDir, 'link_escape.txt'),
      /resolves outside the current workspace/i
    );

    await assert.rejects(
      () => fileService.readFile(wsFixture, 'link_escape.txt'),
      /resolves outside the current workspace/i
    );

    await assert.rejects(
      () => fileService.saveFile(wsFixture, 'link_escape.txt', 'attempted overwrite'),
      /resolves outside the current workspace/i
    );
  });

  test('create operation through external symlinked parent is blocked', async () => {
    const parentLink = path.join(tmpDir, 'link_folder');
    try {
      fs.symlinkSync(outsideDir, parentLink, 'dir');
    } catch (e) {
      return;
    }

    await assert.rejects(
      () => fileService.createEntry(wsFixture, 'link_folder/injected.txt', 'file'),
      /resolves outside the current workspace/i
    );
  });
});
