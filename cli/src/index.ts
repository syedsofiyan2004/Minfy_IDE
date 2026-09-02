import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiResponse, RegisterWorkspaceResponse, RuntimeStatusResponse } from '@minfy/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RUNTIME_PORT = 4560;
export const RUNTIME_HOST = '127.0.0.1';
export const BASE_URL = `http://${RUNTIME_HOST}:${RUNTIME_PORT}`;

// State file path in user home directory
export const STATE_FILE_PATH = path.join(os.homedir(), '.minfy', 'runtime-state.json');

export interface ValidatedRuntimeState {
  valid: boolean;
  port?: number;
  pid?: number;
  token?: string;
  runtimeInstanceId?: string;
  startedAt?: string;
}

export interface AuthenticatedRuntimeIdentity {
  authenticated: boolean;
  pid?: number;
  runtimeInstanceId?: string;
}

export type RuntimeRecoveryAction =
  | 'start_fresh'
  | 'reuse_existing'
  | 'clear_stale_and_start'
  | 'safe_terminate_and_restart'
  | 'port_occupied_unverified';

export interface RecoveryInputs {
  isHealthy: boolean;
  isPortBound?: boolean;
  state: ValidatedRuntimeState;
  authenticatedIdentity?: AuthenticatedRuntimeIdentity;
  isRestartRequested?: boolean;
}

export interface RecoveryDecision {
  action: RuntimeRecoveryAction;
  pidToTerminate?: number;
  reason: string;
}

/**
 * Pure decision function governing process termination and startup safety.
 * Principle: Minfy will NEVER terminate a process unless authenticated as a Minfy Runtime instance
 * AND its verified process PID and runtimeInstanceId match recorded state.
 */
export function decideRuntimeRecovery(inputs: RecoveryInputs): RecoveryDecision {
  const { isHealthy, isPortBound, state, authenticatedIdentity, isRestartRequested } = inputs;
  const isTokenAuthed = !!authenticatedIdentity?.authenticated;

  // Case 0: Port is occupied by an unverified non-Minfy service (port is bound, but health check failed)
  if (!isHealthy && isPortBound) {
    return {
      action: 'port_occupied_unverified',
      reason: 'Port is occupied by an unverified foreign process. Minfy will not terminate it automatically.',
    };
  }

  // Case 1: Runtime not running and state is missing/invalid
  if (!isHealthy && !state.valid) {
    return {
      action: 'start_fresh',
      reason: 'No running runtime and no state file found.',
    };
  }

  // Case 3: Runtime not running but state file exists -> Stale state
  if (!isHealthy && state.valid) {
    return {
      action: 'clear_stale_and_start',
      reason: 'Runtime is not responding; clearing stale runtime-state.json and starting fresh.',
    };
  }

  // If a Minfy health response was received on port:
  if (isHealthy) {
    const identityMatchesState =
      state.valid &&
      isTokenAuthed &&
      typeof state.pid === 'number' &&
      typeof state.runtimeInstanceId === 'string' &&
      state.pid === authenticatedIdentity?.pid &&
      state.runtimeInstanceId === authenticatedIdentity?.runtimeInstanceId;

    // Explicit restart request
    if (isRestartRequested) {
      if (identityMatchesState && state.pid) {
        return {
          action: 'safe_terminate_and_restart',
          pidToTerminate: state.pid,
          reason: 'Verified Minfy Runtime instance confirmed by token, PID, and runtimeInstanceId. Safe to restart.',
        };
      }
      return {
        action: 'port_occupied_unverified',
        reason: 'Port is occupied by an unverified process or state identity mismatch. Minfy will not terminate it automatically.',
      };
    }

    // Normal startup: token authenticates and identity matches -> reuse
    if (identityMatchesState && state.token) {
      return {
        action: 'reuse_existing',
        reason: 'Authenticated Minfy Runtime is running with matching instance identity.',
      };
    }

    // Port is occupied, but identity mismatch, token invalid, or state missing -> DO NOT KILL
    return {
      action: 'port_occupied_unverified',
      reason: 'A process is responding on runtime port, but valid Minfy authentication and instance identity could not be established. Process will NOT be terminated.',
    };
  }

  return {
    action: 'start_fresh',
    reason: 'Default start path.',
  };
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

// Check if port is bound/listening by any process
export function isPortBound(port: number = RUNTIME_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, RUNTIME_HOST);
  });
}

// Ping health check (unauthenticated)
export function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/api/health`, { timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(res.statusCode === 200 && json?.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Verify token against privileged endpoint and retrieve authenticated runtime identity
export function verifyRuntimeIdentity(token: string): Promise<AuthenticatedRuntimeIdentity> {
  return new Promise((resolve) => {
    const req = http.get(
      `${BASE_URL}/api/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 1000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const json: ApiResponse<RuntimeStatusResponse> = JSON.parse(body);
              if (json.success && json.data) {
                return resolve({
                  authenticated: true,
                  pid: json.data.pid,
                  runtimeInstanceId: json.data.runtimeInstanceId,
                });
              }
            }
          } catch {}
          resolve({ authenticated: false });
        });
      }
    );
    req.on('error', () => resolve({ authenticated: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ authenticated: false });
    });
  });
}

// Read and strictly validate runtime state file
export function readRuntimeState(): ValidatedRuntimeState {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const state = JSON.parse(raw);
      if (
        state &&
        typeof state.token === 'string' &&
        state.token.trim().length === 64 &&
        typeof state.pid === 'number' &&
        typeof state.port === 'number' &&
        typeof state.runtimeInstanceId === 'string' &&
        state.runtimeInstanceId.trim().length > 0
      ) {
        return {
          valid: true,
          port: state.port,
          pid: state.pid,
          token: state.token.trim(),
          runtimeInstanceId: state.runtimeInstanceId.trim(),
          startedAt: state.startedAt,
        };
      }
    }
  } catch {}
  return { valid: false };
}

// Check if a PID is alive
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Diagnostic helper: Find PID listening on runtime port (FOR REPORTING ONLY, NEVER DIRECT TERMINATION)
export function findPortPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';
    if (isWin) {
      const netstatCmd = fs.existsSync('C:\\Windows\\System32\\netstat.exe')
        ? 'C:\\Windows\\System32\\netstat.exe'
        : 'netstat';
      exec(`${netstatCmd} -ano -p tcp`, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
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

// Terminate a verified Minfy PID safely
export function terminatePid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      process.kill(pid);
    } catch {}

    if (os.platform() === 'win32') {
      const taskkillCmd = fs.existsSync('C:\\Windows\\System32\\taskkill.exe')
        ? 'C:\\Windows\\System32\\taskkill.exe'
        : 'taskkill';
      exec(`${taskkillCmd} /PID ${pid} /F /T`, () => {
        setTimeout(resolve, 600);
      });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
      setTimeout(resolve, 600);
    }
  });
}

// Spawn new runtime daemon
export function spawnRuntimeProcess(): void {
  const runtimeDist = path.resolve(__dirname, '../../apps/runtime/dist/index.js');
  const runtimeSrc = path.resolve(__dirname, '../../apps/runtime/src/index.ts');

  const minfyDir = path.join(os.homedir(), '.minfy');
  if (!fs.existsSync(minfyDir)) {
    fs.mkdirSync(minfyDir, { recursive: true });
  }
  const logPath = path.join(minfyDir, 'runtime.log');
  const out = fs.openSync(logPath, 'a');
  const err = fs.openSync(logPath, 'a');

  let proc;
  const isWindows = os.platform() === 'win32';

  if (fs.existsSync(runtimeDist)) {
    proc = spawn(process.execPath, [runtimeDist], {
      detached: true,
      stdio: ['ignore', out, err],
      windowsHide: isWindows,
    });
  } else if (fs.existsSync(runtimeSrc)) {
    proc = spawn('npx', ['tsx', runtimeSrc], {
      shell: true,
      detached: true,
      stdio: ['ignore', out, err],
      windowsHide: isWindows,
    });
  } else {
    throw new Error('Could not locate Minfy runtime entrypoint. Please run npm run build first.');
  }

  proc.unref();
}

// Restart runtime command handler
export async function restartRuntimeDaemon(): Promise<string> {
  console.log('\x1b[34m[Minfy]\x1b[0m Checking runtime process ownership on port ' + RUNTIME_PORT + '...');

  const isHealthy = await checkHealth();
  const portBound = await isPortBound(RUNTIME_PORT);
  const state = readRuntimeState();
  let authenticatedIdentity: AuthenticatedRuntimeIdentity | undefined;

  if (state.valid && state.token) {
    authenticatedIdentity = await verifyRuntimeIdentity(state.token);
  }

  const decision = decideRuntimeRecovery({
    isHealthy,
    isPortBound: portBound,
    state,
    authenticatedIdentity,
    isRestartRequested: true,
  });

  if (decision.action === 'port_occupied_unverified') {
    const occupiedPid = await findPortPid(RUNTIME_PORT);
    console.error(`
\x1b[31m[Minfy Error]\x1b[0m Port ${RUNTIME_PORT} is in use by an unverified process or state identity mismatch${occupiedPid ? ` (PID: ${occupiedPid})` : ''}.
Minfy will NOT terminate this process because its identity could not be verified.

Please free port ${RUNTIME_PORT} or terminate the conflicting process manually.
`);
    process.exit(1);
  }

  if (decision.action === 'safe_terminate_and_restart' && decision.pidToTerminate) {
    console.log(`\x1b[34m[Minfy]\x1b[0m Terminating verified Minfy Runtime (PID: ${decision.pidToTerminate})...`);
    await terminatePid(decision.pidToTerminate);
  }

  // Wait until port is completely released
  for (let i = 0; i < 30; i++) {
    const bound = await isPortBound(RUNTIME_PORT);
    if (!bound) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Grace period for OS socket TIME_WAIT release
  await new Promise((r) => setTimeout(r, 500));

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH);
    }
  } catch {}

  spawnRuntimeProcess();

  // Poll until healthy and new state written
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await checkHealth()) {
      const newState = readRuntimeState();
      if (newState.valid && newState.token) {
        const freshIdentity = await verifyRuntimeIdentity(newState.token);
        if (freshIdentity.authenticated) {
          console.log('\x1b[32m[Minfy]\x1b[0m Runtime restarted and authenticated successfully.');
          return newState.token;
        }
      }
    }
  }

  throw new Error('Timed out waiting for restarted Minfy runtime to become ready.');
}

// Robust daemon startup and state recovery
export async function ensureRuntimeStarted(): Promise<string> {
  const isHealthy = await checkHealth();
  const portBound = await isPortBound(RUNTIME_PORT);
  const state = readRuntimeState();
  let authenticatedIdentity: AuthenticatedRuntimeIdentity | undefined;

  if (state.valid && state.token) {
    authenticatedIdentity = await verifyRuntimeIdentity(state.token);
  }

  const decision = decideRuntimeRecovery({
    isHealthy,
    isPortBound: portBound,
    state,
    authenticatedIdentity,
    isRestartRequested: false,
  });

  // Fast path: reuse authenticated runtime
  if (decision.action === 'reuse_existing' && state.token) {
    return state.token;
  }

  // Stale state cleanup
  if (decision.action === 'clear_stale_and_start') {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        fs.unlinkSync(STATE_FILE_PATH);
      }
    } catch {}
  }

  // Unverified port occupation -> DO NOT KILL
  if (decision.action === 'port_occupied_unverified') {
    const occupiedPid = await findPortPid(RUNTIME_PORT);
    console.error(`
\x1b[31m[Minfy Error]\x1b[0m Port ${RUNTIME_PORT} is in use by another or unverified process${occupiedPid ? ` (PID: ${occupiedPid})` : ''}.
Minfy will NOT terminate this process automatically.

If this was a previous Minfy instance that lost authentication state, run:
  \x1b[1mminfy --restart-runtime\x1b[0m
`);
    process.exit(1);
  }

  // Start fresh runtime
  console.log('\x1b[34m[Minfy]\x1b[0m Starting Minfy local runtime...');
  spawnRuntimeProcess();

  // Poll until runtime is ready and token is written
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkHealth()) {
      const freshState = readRuntimeState();
      if (freshState.valid && freshState.token) {
        const freshIdentity = await verifyRuntimeIdentity(freshState.token);
        if (freshIdentity.authenticated) {
          console.log('\x1b[32m[Minfy]\x1b[0m Runtime started successfully.');
          return freshState.token;
        }
      }
    }
  }

  throw new Error('Timed out waiting for Minfy local runtime to start.');
}

// Register workspace via authenticated HTTP POST
export function registerWorkspace(targetDir: string, token: string): Promise<RegisterWorkspaceResponse> {
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
  minfy --restart-runtime    Stop running verified runtime daemon and start a fresh instance
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

// Run CLI when invoked directly
if (process.argv[1] === __filename || process.argv[1]?.endsWith('cli/dist/index.js')) {
  main();
}
