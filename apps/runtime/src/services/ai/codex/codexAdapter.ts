import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AIModel,
  AIProviderStatus,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  CodexLoginStartResponse,
  CodexLoginStatusResponse,
} from '@minfy/shared';
import { AIProviderAdapter } from '../types.js';
import { codexDiscoveryService } from './codexDiscovery.js';
import { codexRuntimeManager } from './codexRuntimeManager.js';
import { CodexTurnCompletedParams, CodexAgentMessageDeltaParams, CodexThreadTokenUsageUpdatedParams } from './codexTypes.js';

interface ActiveTurnContext {
  threadId: string;
  turnId: string;
  accumulatedText: string;
  tokens?: { input: number; output: number };
  startedAt: string;
  startTime: number;
}

export class CodexAdapter implements AIProviderAdapter {
  public readonly id = 'codex';
  public readonly name = 'OpenAI Codex';
  public readonly type = 'subscription' as const;
  public readonly source = 'built-in' as const;
  public readonly protocol = 'codex-app-server';

  private activeTurns: Map<string, ActiveTurnContext> = new Map();
  private sandboxDirectory: string;

  constructor() {
    this.sandboxDirectory = path.join(os.homedir(), '.minfy', 'codex', 'prompt-sandbox');
  }

  /**
   * Returns the prompt sandbox directory. Exposed for testing and verification.
   */
  public getSandboxDirectory(): string {
    return this.sandboxDirectory;
  }

  /**
   * Ensures the prompt sandbox directory exists.
   */
  private ensureSandboxDirectory(): void {
    if (!fs.existsSync(this.sandboxDirectory)) {
      fs.mkdirSync(this.sandboxDirectory, { recursive: true });
    }
  }

  private cachedConnectionState: {
    state: {
      connected: boolean;
      status: AIProviderStatus;
      reason?: string;
      statusReason?: string;
      planType?: string;
    };
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL_MS = 15000;

  /**
   * Invalidates cached connection state (e.g. after login or logout).
   */
  public invalidateStatusCache(): void {
    this.cachedConnectionState = null;
  }

  public async getStatus(explicit = false): Promise<{ status: AIProviderStatus; reason?: string; modelsCount?: number }> {
    const conn = await this.getConnectionState(explicit);
    return {
      status: conn.status || (conn.connected ? 'available' : 'unavailable'),
      reason: conn.reason || conn.statusReason,
    };
  }

  public async getConnectionState(explicit = false): Promise<{
    connected: boolean;
    status: AIProviderStatus;
    reason?: string;
    statusReason?: string;
    planType?: string;
  }> {
    if (!explicit && this.cachedConnectionState && Date.now() - this.cachedConnectionState.timestamp < this.CACHE_TTL_MS) {
      return this.cachedConnectionState.state;
    }

    const discovery = await codexDiscoveryService.discover();
    if (!discovery.available) {
      const state = {
        connected: false,
        status: 'unavailable' as AIProviderStatus,
        reason: discovery.reason || 'Codex runtime not found. Install the official Codex CLI, then refresh Minfy.',
        statusReason: discovery.reason || 'Codex runtime not found. Install the official Codex CLI, then refresh Minfy.',
      };
      this.cachedConnectionState = { state, timestamp: Date.now() };
      return state;
    }

    // Lazy startup: do not globally start Codex during Minfy Runtime boot if Codex is never used.
    if (!codexRuntimeManager.isRunning() && !explicit) {
      return {
        connected: false,
        status: 'unavailable' as AIProviderStatus,
        reason: 'Sign in with ChatGPT to use Codex.',
        statusReason: 'Sign in with ChatGPT to use Codex.',
      };
    }

    try {
      // Lazily start or obtain the App Server client
      const client = await codexRuntimeManager.getClient();
      const accountRes = await client.getAccount();

      if (accountRes.account && accountRes.account.type === 'chatgpt') {
        const chatgptAcc = accountRes.account as { type: 'chatgpt'; planType?: string };
        const plan = typeof chatgptAcc.planType === 'string' ? chatgptAcc.planType : undefined;
        const planLabel = plan && plan !== 'unknown' ? ` (${plan.toUpperCase()})` : '';
        const msg = `Signed in with ChatGPT${planLabel}. Account usage limits apply.`;
        const state = {
          connected: true,
          status: 'available' as AIProviderStatus,
          reason: msg,
          statusReason: msg,
          planType: plan,
        };
        this.cachedConnectionState = { state, timestamp: Date.now() };
        return state;
      }

      const state = {
        connected: false,
        status: 'unavailable' as AIProviderStatus,
        reason: 'Sign in with ChatGPT to use Codex.',
        statusReason: 'Sign in with ChatGPT to use Codex.',
      };
      this.cachedConnectionState = { state, timestamp: Date.now() };
      return state;
    } catch (err: any) {
      const msg = `Codex App Server could not be started: ${err?.message || err}`;
      const state = {
        connected: false,
        status: 'unavailable' as AIProviderStatus,
        reason: msg,
        statusReason: msg,
      };
      // Keep short failure cache
      this.cachedConnectionState = { state, timestamp: Date.now() };
      return state;
    }
  }

  public async listModels(): Promise<AIModel[]> {
    const discovery = await codexDiscoveryService.discover();
    if (!discovery.available) {
      return [];
    }

    try {
      const client = await codexRuntimeManager.getClient();
      const res = await client.listModels();

      if (!res.data || !Array.isArray(res.data)) {
        return [];
      }

      return res.data
        .filter((rawModel) => !rawModel.hidden)
        .map((rawModel) => {
          const supportsVision =
            Array.isArray(rawModel.inputModalities) &&
            rawModel.inputModalities.includes('image');

          return {
            id: rawModel.id,
            displayName: rawModel.displayName || rawModel.id,
            providerId: this.id,
            executionLocation: 'cloud',
            billingType: 'unknown',
            supportsStreaming: true,
            supportsVision,
            isDefault: Boolean(rawModel.isDefault),
            costDescription: 'Codex via ChatGPT account. Account usage limits apply.',
          };
        });
    } catch (err) {
      return [];
    }
  }

  public async generate(
    request: AIGenerateRequest,
    onEvent: (event: AIStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<AIUsage> {
    const client = await codexRuntimeManager.getClient();

    this.ensureSandboxDirectory();

    // 1. Start thread with Minfy-provided context isolation
    const threadRes = await client.startThread({
      cwd: this.sandboxDirectory,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
      model: request.modelId,
      baseInstructions:
        "You are Codex inside Minfy IDE. Answer the user's explicit software-development question. Do not inspect local files or run commands. No repository context has been provided.",
    });

    const threadId = threadRes.thread.id;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    const turnContext: ActiveTurnContext = {
      threadId,
      turnId: '',
      accumulatedText: '',
      startedAt,
      startTime,
    };
    this.activeTurns.set(threadId, turnContext);

    onEvent({ type: 'started' });

    // Handle AbortSignal cancellation
    let activeTurnId: string | null = null;
    const abortHandler = async () => {
      try {
        if (activeTurnId) {
          await client.interruptTurn({ threadId, turnId: activeTurnId });
        }
      } catch {}
    };

    if (signal) {
      if (signal.aborted) {
        await abortHandler();
      } else {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    return new Promise<AIUsage>((resolve, reject) => {
      let isResolved = false;
      let earlyCompletedParams: CodexTurnCompletedParams | null = null;

      const finishTurn = (status: 'completed' | 'cancelled' | 'error', errorMsg?: string) => {
        if (isResolved) return;
        isResolved = true;

        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        client.off('agentMessageDelta', deltaListener);
        client.off('turnCompleted', completedListener);
        client.off('tokenUsageUpdated', tokenListener);

        const durationMs = Date.now() - startTime;
        const usage: AIUsage = {
          providerId: this.id,
          modelId: request.modelId,
          resolvedModelId: request.modelId,
          executionLocation: 'cloud',
          billingType: 'unknown',
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs,
          inputTokenCount: turnContext.tokens?.input,
          outputTokenCount: turnContext.tokens?.output,
          status,
          costDescription: 'Codex via ChatGPT account. Minfy-provided context isolation active. Account usage limits apply.',
        };

        this.activeTurns.delete(threadId);

        if (status === 'error') {
          onEvent({ type: 'error', error: errorMsg || 'Codex generation failed' });
          reject(new Error(errorMsg || 'Codex generation failed'));
        } else {
          onEvent({ type: 'completed', usage });
          resolve(usage);
        }
      };

      // Register listeners BEFORE startTurn to eliminate any race condition
      const deltaListener = (params: CodexAgentMessageDeltaParams) => {
        if (params.threadId === threadId && (!activeTurnId || params.turnId === activeTurnId) && params.delta) {
          turnContext.accumulatedText += params.delta;
          onEvent({ type: 'text-delta', textDelta: params.delta });
        }
      };

      const tokenListener = (params: CodexThreadTokenUsageUpdatedParams) => {
        if (params.threadId === threadId && (!activeTurnId || params.turnId === activeTurnId)) {
          const breakdown = params.tokenUsage?.last || params.tokenUsage?.total;
          if (breakdown) {
            turnContext.tokens = {
              input: breakdown.inputTokens,
              output: breakdown.outputTokens,
            };
          }
        }
      };

      const completedListener = (params: CodexTurnCompletedParams) => {
        if (params.threadId === threadId && (!activeTurnId || params.turn.id === activeTurnId)) {
          if (!activeTurnId) {
            // Arrived in the same tick before startTurn promise resolved
            earlyCompletedParams = params;
            return;
          }
          const status = params.turn.status;
          if (status === 'completed') {
            finishTurn('completed');
          } else if (status === 'interrupted') {
            finishTurn('cancelled');
          } else {
            const err = params.turn.error?.message || 'Codex turn failed';
            finishTurn('error', err);
          }
        }
      };

      client.on('agentMessageDelta', deltaListener);
      client.on('tokenUsageUpdated', tokenListener);
      client.on('turnCompleted', completedListener);

      // Now dispatch startTurn
      client
        .startTurn({
          threadId,
          input: [{ type: 'text', text: request.prompt, text_elements: [] }],
          cwd: this.sandboxDirectory,
          model: request.modelId,
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
        })
        .then((turnRes) => {
          activeTurnId = turnRes.turn.id;
          turnContext.turnId = activeTurnId;

          if (signal?.aborted) {
            abortHandler();
          }

          // If turnCompleted notification arrived before startTurn returned:
          if (earlyCompletedParams) {
            const status = earlyCompletedParams.turn.status;
            if (status === 'completed') {
              finishTurn('completed');
            } else if (status === 'interrupted') {
              finishTurn('cancelled');
            } else {
              const err = earlyCompletedParams.turn.error?.message || 'Codex turn failed';
              finishTurn('error', err);
            }
          }
        })
        .catch((err) => {
          finishTurn('error', err?.message || 'Failed to start turn');
        });
    });
  }

  public async cancel(threadId?: string): Promise<void> {
    if (!threadId) {
      // Cancel all active turns
      for (const [tId, ctx] of this.activeTurns.entries()) {
        try {
          const client = await codexRuntimeManager.getClient();
          await client.interruptTurn({ threadId: tId, turnId: ctx.turnId });
        } catch {}
      }
      return;
    }

    const ctx = this.activeTurns.get(threadId);
    if (ctx) {
      try {
        const client = await codexRuntimeManager.getClient();
        await client.interruptTurn({ threadId, turnId: ctx.turnId });
      } catch {}
    }
  }

  // --- Codex Account / Login Management ---

  public async startLogin(): Promise<CodexLoginStartResponse> {
    const discovery = await codexDiscoveryService.discover();
    if (!discovery.available) {
      throw new Error(discovery.reason || 'Codex runtime not found.');
    }

    const client = await codexRuntimeManager.getClient();
    const res = await client.startLogin();

    codexRuntimeManager.registerLoginSession(res.loginId, res.authUrl);
    this.invalidateStatusCache();

    return {
      loginId: res.loginId,
      authUrl: res.authUrl,
      status: 'pending',
    };
  }

  public async getLoginStatus(loginId: string): Promise<CodexLoginStatusResponse> {
    const session = codexRuntimeManager.getLoginSession(loginId);
    if (!session) {
      // Check if account is now connected
      try {
        const client = await codexRuntimeManager.getClient();
        const acc = await client.getAccount();
        if (acc.account && acc.account.type === 'chatgpt') {
          this.invalidateStatusCache();
          return { loginId, status: 'completed' };
        }
      } catch {}
      return { loginId, status: 'failed', error: 'Login session expired or invalid' };
    }

    if (session.status === 'completed') {
      this.invalidateStatusCache();
      return { loginId, status: 'completed' };
    }

    if (session.status === 'failed') {
      return { loginId, status: 'failed', error: session.error };
    }

    return { loginId, status: 'pending' };
  }

  public async cancelLogin(loginId: string): Promise<void> {
    this.invalidateStatusCache();
    codexRuntimeManager.cancelLoginSession(loginId);
    try {
      const client = await codexRuntimeManager.getClient();
      await client.cancelLogin(loginId);
    } catch {}
  }
}

export const codexAdapter = new CodexAdapter();
