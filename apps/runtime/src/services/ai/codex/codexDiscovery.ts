import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export interface CodexDiscoveryResult {
  available: boolean;
  version?: string;
  command?: string;
  baseArgs?: string[];
  reason?: string;
}

export class CodexDiscoveryService {
  private cachedResult: CodexDiscoveryResult | null = null;

  /**
   * Clears the discovery cache.
   */
  public invalidateCache(): void {
    this.cachedResult = null;
  }

  /**
   * Resolves the executable path and arguments to run Codex safely with shell: false.
   */
  public async discover(): Promise<CodexDiscoveryResult> {
    if (this.cachedResult) {
      return this.cachedResult;
    }

    const resolution = this.resolveCodexRunner();
    if (!resolution) {
      this.cachedResult = {
        available: false,
        reason: 'Codex runtime not found. Install the official Codex CLI, then refresh Minfy.',
      };
      return this.cachedResult;
    }

    // Probe version using safe spawn with shell: false
    const versionResult = await this.probeVersion(resolution.command, resolution.baseArgs);
    if (!versionResult.success || !versionResult.version) {
      this.cachedResult = {
        available: false,
        reason: versionResult.error || 'Codex executable was detected but failed to report its version.',
      };
      return this.cachedResult;
    }

    this.cachedResult = {
      available: true,
      version: versionResult.version,
      command: resolution.command,
      baseArgs: resolution.baseArgs,
    };

    return this.cachedResult;
  }

  /**
   * Resolves command and base arguments without invoking a shell.
   */
  public resolveCodexRunner(): { command: string; baseArgs: string[] } | null {
    // 1. Explicit CODEX_EXECUTABLE override
    const explicitPath = process.env.CODEX_EXECUTABLE;
    if (explicitPath !== undefined) {
      if (explicitPath && fs.existsSync(explicitPath)) {
        if (explicitPath.endsWith('.js')) {
          return { command: process.execPath, baseArgs: [path.resolve(explicitPath)] };
        }
        return { command: path.resolve(explicitPath), baseArgs: [] };
      }
      return null;
    }

    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // 2a. Common Windows global npm locations for @openai/codex
      const candidatePaths = [
        path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
        path.join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      ];

      for (const candidate of candidatePaths) {
        if (candidate && fs.existsSync(candidate)) {
          return { command: process.execPath, baseArgs: [candidate] };
        }
      }

      // 2b. Search PATH on Windows
      const pathEnv = process.env.PATH || '';
      const pathDirs = pathEnv.split(path.delimiter);

      for (const dir of pathDirs) {
        if (!dir) continue;
        // Direct codex.exe
        const exePath = path.join(dir, 'codex.exe');
        if (fs.existsSync(exePath)) {
          return { command: exePath, baseArgs: [] };
        }

        // Relative codex.js from npm cmd directory
        const npmJsPath = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        if (fs.existsSync(npmJsPath)) {
          return { command: process.execPath, baseArgs: [npmJsPath] };
        }
      }
    } else {
      // Unix / macOS
      const pathEnv = process.env.PATH || '';
      const pathDirs = pathEnv.split(path.delimiter);

      for (const dir of pathDirs) {
        if (!dir) continue;
        const candidate = path.join(dir, 'codex');
        if (fs.existsSync(candidate)) {
          try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return { command: candidate, baseArgs: [] };
          } catch {
            // Not executable
          }
        }
      }
    }

    return null;
  }

  /**
   * Probes `command ...baseArgs --version` using safe spawn with shell: false.
   */
  private probeVersion(
    command: string,
    baseArgs: string[]
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, [...baseArgs, '--version'], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err: any) {
        return resolve({ success: false, error: err?.message || 'Failed to spawn codex' });
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({ success: false, error: 'Codex version probe timed out' });
      }, 5000);
      timer.unref();

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          // Parse stdout, e.g. "codex-cli 0.151.0" or "0.151.0"
          const match = stdout.match(/([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?)/);
          const version = match ? match[1] : stdout.trim();
          resolve({ success: true, version });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });
    });
  }
}

export const codexDiscoveryService = new CodexDiscoveryService();
