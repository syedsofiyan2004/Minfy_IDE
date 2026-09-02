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

// State file path in user home directory
const STATE_FILE_PATH = path.join(os.homedir(), '.minfy', 'runtime-state.json');

interface ValidatedRuntimeState {
  valid: boolean;
  port?: number;
  pid?: number;
  token?: string;
  startedAt?: string;
}

// Cross-platform browser opener
function openBrowser(url: string) {
  const platform = os.platform();
  if (platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

// Ping health check (unauthenticated)
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

// Verify token against privileged endpoint
function verifyAuthToken(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `${BASE_URL}/api/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Read and strictly validate runtime state file
function readRuntimeState(): ValidatedRuntimeState {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const state = JSON.parse(raw);
      if (
        state &&
        typeof state.token === 'string' &&
        state.token.trim().length === 64 &&
        typeof state.pid === 'number' &&
        typeof state.port === 'number'
      ) {
        return {
          valid: true,
          port: state.port,
          pid: state.pid,
          token: state.token.trim(),
          startedAt: state.startedAt,
        };
      }
    }
  } catch {}
  return { valid: false };
}

// Check if a PID is alive
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Find PID listening on runtime port
function findPortPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';
    if (isWin) {
      exec(`netstat -ano -p tcp | findstr :${port}`, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(pid) && pid > 0) return resolve(pid);
          }
        }
        resolve(null);
      });
    } else {
      exec(`lsof -t -i :${port}`, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const pid = parseInt(stdout.trim().split('\n')[0], 10);
        if (!isNaN(pid) && pid > 0) return resolve(pid);
        resolve(null);
      });
    }
  });
}

// Terminate a PID safely
function terminatePid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      exec(`taskkill /PID ${pid} /F /T`, () => {
        setTimeout(resolve, 600);
      });
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
      setTimeout(resolve, 600);
    }
  });
}

// Spawn new runtime daemon
function spawnRuntimeProcess(): void {
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
}

// Restart runtime command handler
async function restartRuntimeDaemon(): Promise<string> {
  console.log('\x1b[34m[Minfy]\x1b[0m Restarting Minfy local runtime...');

  const state = readRuntimeState();
  if (state.valid && state.pid && isProcessAlive(state.pid)) {
    await terminatePid(state.pid);
  }

  const portPid = await findPortPid(RUNTIME_PORT);
  if (portPid && isProcessAlive(portPid)) {
    await terminatePid(portPid);
  }

  // Wait until port is completely released
  for (let i = 0; i < 20; i++) {
    const isHealthy = await checkHealth();
    if (!isHealthy) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH);
    }
  } catch {}

  spawnRuntimeProcess();

  // Poll until healthy and new state written
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkHealth()) {
      const newState = readRuntimeState();
      if (newState.valid && newState.token) {
        const isAuthed = await verifyAuthToken(newState.token);
        if (isAuthed) {
          console.log('\x1b[32m[Minfy]\x1b[0m Runtime restarted and authenticated successfully.');
          return newState.token;
        }
      }
    }
  }

  throw new Error('Timed out waiting for restarted Minfy runtime to become ready.');
}

// Robust daemon startup and state recovery
async function ensureRuntimeStarted(): Promise<string> {
  const isHealthy = await checkHealth();
  const state = readRuntimeState();

  // CASE B: Runtime running and state token is valid (normal fast path)
  if (isHealthy && state.valid && state.token) {
    const isAuthed = await verifyAuthToken(state.token);
    if (isAuthed) {
      return state.token;
    }
  }

  // CASE C: Runtime not running, but stale state exists
  if (!isHealthy && fs.existsSync(STATE_FILE_PATH)) {
    try {
      fs.unlinkSync(STATE_FILE_PATH);
    } catch {}
  }

  // CASE D / E: Runtime is running, but auth token is invalid or state file missing
  if (isHealthy) {
    if (state.valid && state.pid && isProcessAlive(state.pid)) {
      console.warn('\x1b[33m[Minfy Warning]\x1b[0m Runtime token mismatch detected. Performing safe daemon restart...');
      return await restartRuntimeDaemon();
    } else {
      console.error(`
\x1b[31m[Minfy Error]\x1b[0m A process is running on port ${RUNTIME_PORT}, but valid Minfy authentication state is missing.

To recover and restart the Minfy runtime, run:
  \x1b[1mminfy --restart-runtime\x1b[0m
`);
      process.exit(1);
    }
  }

  // CASE A: Runtime not running, start fresh daemon
  console.log('\x1b[34m[Minfy]\x1b[0m Starting Minfy local runtime...');
  spawnRuntimeProcess();

  // Poll until runtime is ready and token is written
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkHealth()) {
      const freshState = readRuntimeState();
      if (freshState.valid && freshState.token) {
        const isAuthed = await verifyAuthToken(freshState.token);
        if (isAuthed) {
          console.log('\x1b[32m[Minfy]\x1b[0m Runtime started successfully.');
          return freshState.token;
        }
      }
    }
  }

  throw new Error('Timed out waiting for Minfy local runtime to start.');
}

// Register workspace via authenticated HTTP POST
function registerWorkspace(targetDir: string, token: string): Promise<RegisterWorkspaceResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ path: targetDir });
    const req = http.request(
      `${BASE_URL}/api/workspaces`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
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
\x1b[1;34mMinfy IDE CLI\x1b[0m

\x1b[1mUsage:\x1b[0m
  minfy [path]               Open directory in Minfy IDE (defaults to current directory)
  minfy --restart-runtime    Stop running runtime daemon and start a fresh authenticated instance
  minfy --help               Show help
  minfy --version            Show version
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  if (args.includes('--restart-runtime')) {
    try {
      await restartRuntimeDaemon();
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31m[Minfy Error]\x1b[0m ${err.message || err}`);
      process.exit(1);
    }
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
    const token = await ensureRuntimeStarted();

    const { workspace } = await registerWorkspace(resolvedPath, token);

    // Sanitized URL for console output (never prints secret token fragment)
    const sanitizedUrl = `${BASE_URL}/?workspaceId=${workspace.id}`;

    // Full URL with fragment passed directly to OS browser
    const browserUrl = `${BASE_URL}/?workspaceId=${workspace.id}#runtimeToken=${token}`;

    console.log(`\x1b[34m[Minfy IDE]\x1b[0m Workspace: \x1b[33m${workspace.name}\x1b[0m (${workspace.rootPath})`);
    console.log(`\x1b[32m[Minfy IDE]\x1b[0m Opening in browser: \x1b[4m${sanitizedUrl}\x1b[0m`);

    openBrowser(browserUrl);
  } catch (err: any) {
    console.error(`\x1b[31m[Minfy Error]\x1b[0m ${err.message || err}`);
    process.exit(1);
  }
}

main();
