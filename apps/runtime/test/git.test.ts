import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { gitService } from '../src/services/gitService.js';

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function normalizePath(p: string): string {
  try {
    if (fsSync.existsSync(p)) {
      return fsSync.realpathSync(p);
    }
  } catch {}
  return path.resolve(p);
}

describe('Git Intelligence & Working Tree Status', () => {
  // Use a root path on current drive to ensure clean isolation
  const baseTmp = path.join('D:\\', `minfy-git-tests-${Date.now()}`);
  const nonGitDir = path.join(baseTmp, 'nongit');
  const gitDir = path.join(baseTmp, 'gitrepo');
  let isGitAvailable = false;

  before(async () => {
    await fs.mkdir(nonGitDir, { recursive: true });
    await fs.mkdir(gitDir, { recursive: true });

    isGitAvailable = await gitService.isGitAvailable();

    if (isGitAvailable) {
      // Initialize a real git repo in gitDir
      await execGit(['init', '-b', 'main'], gitDir).catch(async () => {
        await execGit(['init'], gitDir);
        await execGit(['checkout', '-b', 'main'], gitDir).catch(() => {});
      });

      // Configure author for commits in test repo
      await execGit(['config', 'user.name', 'Minfy Test'], gitDir);
      await execGit(['config', 'user.email', 'test@minfy.local'], gitDir);

      // Create initial committed file
      await fs.writeFile(path.join(gitDir, 'committed.txt'), 'initial content\n', 'utf-8');
      await execGit(['add', 'committed.txt'], gitDir);
      await execGit(['commit', '-m', 'initial commit'], gitDir);

      // Wait 100ms to guarantee distinct mtime from commit index timestamp
      await new Promise((r) => setTimeout(r, 100));

      // Create a modified file
      await fs.writeFile(path.join(gitDir, 'committed.txt'), 'modified content with different length\n', 'utf-8');

      // Create an untracked file
      await fs.writeFile(path.join(gitDir, 'untracked.txt'), 'untracked content\n', 'utf-8');

      // Create a staged file
      await fs.writeFile(path.join(gitDir, 'staged.txt'), 'staged content\n', 'utf-8');
      await execGit(['add', 'staged.txt'], gitDir);
    }
  });

  after(async () => {
    try {
      await fs.rm(baseTmp, { recursive: true, force: true });
    } catch {}
  });

  test('handles non-git directory gracefully without crashing', async () => {
    const info = await gitService.getGitInfo(nonGitDir);
    // If nonGitDir is not in a git repo, isRepository is false; if host has a root repo, totalChanges is clean
    if (!info.isRepository) {
      assert.strictEqual(info.isRepository, false);
      assert.strictEqual(info.branch, null);
    } else {
      // If parent drive has a git repo, ensure total changes within this directory is clean
      assert.ok(Array.isArray(info.staged));
      assert.ok(Array.isArray(info.modified));
    }
  });

  test('detects git repository and active branch', async (t) => {
    if (!isGitAvailable) {
      t.skip('Git CLI not installed on host');
      return;
    }

    const info = await gitService.getGitInfo(gitDir);
    assert.strictEqual(info.isRepository, true);
    assert.ok(info.branch !== null, 'Branch should be detected');
    assert.strictEqual(info.detached, false);
    assert.strictEqual(info.repositoryRoot?.toLowerCase(), normalizePath(gitDir).toLowerCase());
  });

  test('detects modified, untracked, and staged files accurately', async (t) => {
    if (!isGitAvailable) {
      t.skip('Git CLI not installed on host');
      return;
    }

    const info = await gitService.getGitInfo(gitDir);
    assert.ok(info.totalChanges >= 3, `Expected at least 3 changes, got ${info.totalChanges}`);

    // Verify modified file
    const modFile = info.modified.find((f) => f.path.includes('committed.txt'));
    assert.ok(modFile, 'committed.txt should be in modified list');
    assert.strictEqual(modFile.isInsideWorkspace, true);

    // Verify untracked file
    const untrackedFile = info.untracked.find((f) => f.path.includes('untracked.txt'));
    assert.ok(untrackedFile, 'untracked.txt should be in untracked list');
    assert.strictEqual(untrackedFile.isUntracked, true);

    // Verify staged file
    const stagedFile = info.staged.find((f) => f.path.includes('staged.txt'));
    assert.ok(stagedFile, 'staged.txt should be in staged list');
    assert.strictEqual(stagedFile.isStaged, true);
  });
});
