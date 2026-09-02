import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { GitInfo, GitFileStatus } from '@minfy/shared';

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 5000,
        env: {
          ...process.env,
          LANG: 'C',
          LC_ALL: 'C',
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

function normalizePath(p: string): string {
  try {
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    }
  } catch {}
  return path.resolve(p);
}

export class GitService {
  private isGitInstalledCache: boolean | null = null;

  public async isGitAvailable(): Promise<boolean> {
    if (this.isGitInstalledCache !== null) {
      return this.isGitInstalledCache;
    }
    try {
      await execGit(['--version'], process.cwd());
      this.isGitInstalledCache = true;
      return true;
    } catch {
      this.isGitInstalledCache = false;
      return false;
    }
  }

  public async getGitInfo(workspaceRoot: string): Promise<GitInfo> {
    const isAvailable = await this.isGitAvailable();
    if (!isAvailable) {
      return {
        available: false,
        isRepository: false,
        repositoryRoot: null,
        branch: null,
        detached: false,
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
        renamed: [],
        totalChanges: 0,
      };
    }

    const realWorkspace = normalizePath(workspaceRoot);

    // Check if current directory is inside a git working tree
    let isInsideWorkTree = false;
    try {
      const output = await execGit(['rev-parse', '--is-inside-work-tree'], realWorkspace);
      isInsideWorkTree = output === 'true';
    } catch {
      isInsideWorkTree = false;
    }

    if (!isInsideWorkTree) {
      return {
        available: true,
        isRepository: false,
        repositoryRoot: null,
        branch: null,
        detached: false,
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
        renamed: [],
        totalChanges: 0,
      };
    }

    // Get Git Repository Root
    let repoRoot: string | null = null;
    try {
      const rawRoot = await execGit(['rev-parse', '--show-toplevel'], realWorkspace);
      repoRoot = normalizePath(rawRoot);
    } catch {
      repoRoot = realWorkspace;
    }

    // Get Branch or Detached HEAD
    let branch: string | null = null;
    let detached = false;
    let headCommit: string | undefined = undefined;

    try {
      const branchName = await execGit(['branch', '--show-current'], realWorkspace);
      if (branchName) {
        branch = branchName;
      } else {
        // Detached HEAD or fresh repo with no commits
        const shortHead = await execGit(['rev-parse', '--short', 'HEAD'], realWorkspace).catch(() => '');
        if (shortHead) {
          detached = true;
          headCommit = shortHead;
          branch = `HEAD (${shortHead})`;
        } else {
          branch = 'main';
        }
      }
    } catch {
      branch = 'main';
    }

    // Get Porcelain Status scoped to workspace with `-- .`
    const staged: GitFileStatus[] = [];
    const modified: GitFileStatus[] = [];
    const untracked: GitFileStatus[] = [];
    const deleted: GitFileStatus[] = [];
    const renamed: GitFileStatus[] = [];

    const isWindows = process.platform === 'win32';
    const workspaceRootWithSep = realWorkspace.endsWith(path.sep)
      ? realWorkspace
      : realWorkspace + path.sep;

    try {
      const statusOutput = await execGit(['status', '--porcelain=v1', '-uall', '--', '.'], realWorkspace);
      if (statusOutput) {
        const lines = statusOutput.split(/\r?\n/).filter((l) => l.length >= 3);

        for (const line of lines) {
          const indexStatus = line[0];
          const workingTreeStatus = line[1];
          let rawPath = line.slice(2).trim();

          let origPath: string | undefined = undefined;
          if (rawPath.includes(' -> ')) {
            const parts = rawPath.split(' -> ');
            origPath = parts[0].replace(/^"|"$/g, '');
            rawPath = parts[1].replace(/^"|"$/g, '');
          } else {
            rawPath = rawPath.replace(/^"|"$/g, '');
          }

          // Resolve absolute path from realWorkspace (since status was run with -- .)
          const fullPath = normalizePath(path.resolve(realWorkspace, rawPath));
          const isInside = isWindows
            ? fullPath.toLowerCase() === realWorkspace.toLowerCase() ||
              fullPath.toLowerCase().startsWith(workspaceRootWithSep.toLowerCase())
            : fullPath === realWorkspace || fullPath.startsWith(workspaceRootWithSep);

          // Path relative to workspace
          const relToWorkspace = path.relative(realWorkspace, fullPath).replace(/\\/g, '/');

          const statusItem: GitFileStatus = {
            path: isInside ? (relToWorkspace || rawPath) : rawPath,
            indexStatus,
            workingTreeStatus,
            isStaged: indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
            isUnstaged: workingTreeStatus !== ' ' && workingTreeStatus !== '?' && workingTreeStatus !== '!',
            isUntracked: indexStatus === '?' && workingTreeStatus === '?',
            isInsideWorkspace: isInside,
            origPath,
          };

          if (statusItem.isUntracked) {
            untracked.push(statusItem);
          } else {
            if (statusItem.isStaged) {
              staged.push(statusItem);
            }
            if (workingTreeStatus === 'M' || indexStatus === 'M') {
              modified.push(statusItem);
            }
            if (workingTreeStatus === 'D' || indexStatus === 'D') {
              deleted.push(statusItem);
            }
            if (workingTreeStatus === 'R' || indexStatus === 'R') {
              renamed.push(statusItem);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[GitService] Error getting git status:', err);
    }

    const totalChanges = staged.length + modified.length + untracked.length + deleted.length + renamed.length;

    return {
      available: true,
      isRepository: true,
      repositoryRoot: repoRoot,
      branch,
      detached,
      headCommit,
      staged,
      modified,
      untracked,
      deleted,
      renamed,
      totalChanges,
    };
  }
}

export const gitService = new GitService();
