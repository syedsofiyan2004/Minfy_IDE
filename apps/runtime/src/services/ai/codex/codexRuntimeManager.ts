import { ChildProcess, spawn } from 'node:child_process';
import { CodexDiscoveryResult, codexDiscoveryService } from './codexDiscovery.js';
import { CodexAppServerClient } from './codexAppServerClient.js';
import { CodexAccountLoginCompletedParams } from './codexTypes.js';

export interface PendingLoginSession {
  loginId: string;
  authUrl: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  createdAt: number;
}

export class CodexRuntimeManager {
  private child: ChildProcess | null = null;
  private client: CodexAppServerClient | null = null;
  private isStarting = false;
  private startPromise: Promise<CodexAppServerClient> | null = null;
  private lastStderrLines: string[] = [];
  private pendingLogins: Map<string, PendingLoginSession> = new Map();
  private isShuttingDown = false;
  private mockClient: CodexAppServerClient | null = null;

  constructor() {
    this.registerExitHooks();
  }

  /**
   * Allows tests to inject a mock client.
   */
  public setMockClient(mock: CodexAppServerClient | null): void {
    this.mockClient = mock;
  }

  /**
   * Returns whether the App Server process is currently alive and initialized.
   */
  public isRunning(): boolean {
    if (this.mockClient) return true;
    return this.child !== null && this.client !== null && !this.child.killed;
  }

  /**
   * Lazily ensures the App Server is running and initialized.
   */
  public async getClient(): Promise<CodexAppServerClient> {
    if (this.mockClient) {
      if (!this.mockClient.isReady()) {
        await this.mockClient.initialize();
      }
      return this.mockClient;
    }

    if (this.client && this.isRunning()) {
      return this.client;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startAppServer();
    try {
      const client = await this.startPromise;
      return client;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Starts the child process and performs the initialize handshake.
   */
  private async startAppServer(): Promise<CodexAppServerClient> {
    const discovery = await codexDiscoveryService.discover();
    if (!discovery.available || !discovery.command) {
      throw new Error(discovery.reason || 'Codex runtime not found.');
    }

    // Stop any existing dead child
    this.cleanupChild();

    const args = [...(discovery.baseArgs || []), 'app-server'];

    let child: ChildProcess;
    try {
      child = spawn(discovery.command, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err: any) {
      throw new Error(`Failed to start Codex App Server: ${err?.message || err}`);
    }

    this.child = child;
    this.lastStderrLines = [];

    // Capture stderr for local diagnostics (sanitizing URLs and tokens)
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        // Basic sanitization
        const sanitized = line.replace(/https?:\/\/\S+/gi, '[URL redacted]').replace(/ey[a-zA-Z0-9_-]{20,}/g, '[token redacted]');
        this.lastStderrLines.push(sanitized);
        if (this.lastStderrLines.length > 50) {
          this.lastStderrLines.shift();
        }
      }
    });

    const client = new CodexAppServerClient(child.stdin!, child.stdout!);
    this.client = client;

    // Unref child process so it does not block Node event loop
    child.unref();
    if ((child.stdin as any)?.unref) (child.stdin as any).unref();
    if ((child.stdout as any)?.unref) (child.stdout as any).unref();
    if ((child.stderr as any)?.unref) (child.stderr as any).unref();

    // Attach exit listener
    child.on('exit', (code, signal) => {
      this.handleChildExit(code, signal);
    });

    child.on('error', (err) => {
      this.handleChildError(err);
    });

    // Listen for login completion notifications
    client.on('accountLoginCompleted', (params: CodexAccountLoginCompletedParams) => {
      if (params.loginId && this.pendingLogins.has(params.loginId)) {
        const session = this.pendingLogins.get(params.loginId)!;
        if (params.success) {
          session.status = 'completed';
        } else {
          session.status = 'failed';
          session.error = params.error || 'ChatGPT login failed';
        }
      }
    });

    // Perform initialization handshake
    try {
      await client.initialize({
        name: 'minfy',
        title: 'Minfy IDE',
        version: '0.1.0',
      });
    } catch (err: any) {
      this.stop();
      throw new Error(`Codex App Server initialization failed: ${err?.message || err}`);
    }

    return client;
  }

  private handleChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.isShuttingDown) return;
    this.cleanupChild();
  }

  private handleChildError(err: Error): void {
    if (this.isShuttingDown) return;
    this.cleanupChild();
  }

  private cleanupChild(): void {
    if (this.client) {
      this.client.close('Codex App Server process terminated');
      this.client = null;
    }
    if (this.child) {
      try {
        if (!this.child.killed) {
          this.child.kill();
        }
      } catch {}
      this.child = null;
    }
  }

  /**
   * Stops the child process.
   */
  public stop(): void {
    this.cleanupChild();
  }

  // --- Login Session Tracking ---

  public registerLoginSession(loginId: string, authUrl: string): PendingLoginSession {
    const session: PendingLoginSession = {
      loginId,
      authUrl,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.pendingLogins.set(loginId, session);

    // Auto-expire after 10 minutes
    const timer = setTimeout(() => {
      if (this.pendingLogins.get(loginId)?.status === 'pending') {
        this.pendingLogins.delete(loginId);
      }
    }, 10 * 60 * 1000);
    timer.unref();

    return session;
  }

  public getLoginSession(loginId: string): PendingLoginSession | undefined {
    return this.pendingLogins.get(loginId);
  }

  public cancelLoginSession(loginId: string): boolean {
    const session = this.pendingLogins.get(loginId);
    if (!session) return false;
    session.status = 'cancelled';
    this.pendingLogins.delete(loginId);
    return true;
  }

  private registerExitHooks(): void {
    const onExit = () => {
      this.isShuttingDown = true;
      this.stop();
    };

    process.once('exit', onExit);
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
  }
}

export const codexRuntimeManager = new CodexRuntimeManager();
