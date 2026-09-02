import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiResponse, RegisterWorkspaceResponse } from '@minfy/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNTIME_PORT = 4560;
const RUNTIME_HOST = '127.0.0.1';
const BASE_URL = `http://${RUNTIME_HOST}:${RUNTIME_PORT}`;

// Cross-platform browser opener
function openBrowser(url: string) {
  const platform = os.platform();
  if (platform === 'win32') {
    // Windows start command
    exec(`start "" "${url}"`);
  } else if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

// Ping health check
function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/api/health`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Start runtime daemon
async function ensureRuntimeStarted(): Promise<void> {
  const isHealthy = await checkHealth();
  if (isHealthy) {
    return;
  }

  console.log('\x1b[34m[Minfy]\x1b[0m Starting Minfy local runtime...');

  // Locate runtime entrypoint
  const runtimeDist = path.resolve(__dirname, '../../apps/runtime/dist/index.js');
  const runtimeSrc = path.resolve(__dirname, '../../apps/runtime/src/index.ts');

  let proc;
  const isWindows = os.platform() === 'win32';

  if (fs.existsSync(runtimeDist)) {
    if (isWindows) {
      proc = spawn(process.execPath, [runtimeDist], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      proc = spawn(process.execPath, [runtimeDist], {
        detached: true,
        stdio: 'ignore',
      });
    }
  } else if (fs.existsSync(runtimeSrc)) {
    // Development fallback with tsx / node
    proc = spawn('npx', ['tsx', runtimeSrc], {
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    throw new Error('Could not locate Minfy runtime entrypoint. Please run npm run build first.');
  }

  proc.unref();

  // Poll until runtime is ready
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkHealth()) {
      console.log('\x1b[32m[Minfy]\x1b[0m Runtime started successfully.');
      return;
    }
  }

  throw new Error('Timed out waiting for Minfy local runtime to start.');
}

// Register workspace via HTTP POST
function registerWorkspace(targetDir: string): Promise<RegisterWorkspaceResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ path: targetDir });
    const req = http.request(
      `${BASE_URL}/api/workspaces`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json: ApiResponse<RegisterWorkspaceResponse> = JSON.parse(body);
            if (json.success && json.data) {
              resolve(json.data);
            } else {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
\x1b[1;34mMinfy IDE CLI\x1b[0m — Milestone 1

\x1b[1mUsage:\x1b[0m
  minfy [path]           Open directory in Minfy IDE (defaults to current directory)
  minfy --help           Show help
  minfy --version        Show version
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  const rawPath = args[0] || '.';
  const resolvedPath = path.resolve(process.cwd(), rawPath);

  // Validate directory
  if (!fs.existsSync(resolvedPath)) {
    console.error(`\x1b[31m[Minfy Error]\x1b[0m Directory does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isDirectory()) {
    console.error(`\x1b[31m[Minfy Error]\x1b[0m Path is not a directory: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    await ensureRuntimeStarted();

    const { workspace } = await registerWorkspace(resolvedPath);

    const ideUrl = `${BASE_URL}/?workspaceId=${workspace.id}`;

    console.log(`\x1b[34m[Minfy IDE]\x1b[0m Workspace: \x1b[33m${workspace.name}\x1b[0m (${workspace.rootPath})`);
    console.log(`\x1b[32m[Minfy IDE]\x1b[0m Opening in browser: \x1b[4m${ideUrl}\x1b[0m`);

    openBrowser(ideUrl);
  } catch (err: any) {
    console.error(`\x1b[31m[Minfy Error]\x1b[0m ${err.message || err}`);
    process.exit(1);
  }
}

main();
