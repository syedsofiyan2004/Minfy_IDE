import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  CodexInitializeParams,
  CodexInitializeResponse,
  CodexGetAccountResponse,
  CodexLoginAccountResponse,
  CodexModelListResponse,
  CodexThreadStartParams,
  CodexThreadStartResponse,
  CodexTurnStartParams,
  CodexTurnStartResponse,
  CodexTurnInterruptParams,
  CodexAgentMessageDeltaParams,
  CodexTurnCompletedParams,
  CodexAccountLoginCompletedParams,
  CodexThreadTokenUsageUpdatedParams,
} from './codexTypes.js';

export interface PendingRequest {
  id: string;
  method: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeoutTimer: NodeJS.Timeout;
}

export class CodexAppServerClient extends EventEmitter {
  private stdin: Writable;
  private stdout: Readable;
  private rl: readline.Interface;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private nextRequestId = 1;
  private isClosed = false;

  constructor(stdin: Writable, stdout: Readable) {
    super();
    this.stdin = stdin;
    this.stdout = stdout;

    this.rl = readline.createInterface({
      input: this.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.handleClose());
  }

  /**
   * Closes the client and rejects all outstanding requests.
   */
  public close(reason = 'Codex App Server connection closed'): void {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      this.rl.close();
    } catch {}

    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timeoutTimer);
      req.reject(new Error(`${reason} (method: ${req.method})`));
    }
    this.pendingRequests.clear();
    this.emit('closed');
  }

  /**
   * Handles an incoming JSONL line from the App Server.
   */
  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Per specification: malformed JSON line does not crash Minfy
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    // 1. Response to client request: { id, result | error }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const idStr = String(msg.id);
      const pending = this.pendingRequests.get(idStr);
      if (pending) {
        clearTimeout(pending.timeoutTimer);
        this.pendingRequests.delete(idStr);

        if (msg.error) {
          const errMsg = msg.error.message || JSON.stringify(msg.error);
          pending.reject(new Error(`Codex App Server RPC error [${pending.method}]: ${errMsg}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Server-initiated request: { id, method, params }
    if (msg.id !== undefined && typeof msg.method === 'string') {
      this.handleServerInitiatedRequest(String(msg.id), msg.method, msg.params);
      return;
    }

    // 3. Notification: { method, params }
    if (typeof msg.method === 'string') {
      this.handleNotification(msg.method, msg.params);
    }
  }

  /**
   * Handles server-initiated requests.
   * In Milestone 7, Minfy MUST NOT grant mutation/execution approvals.
   * Safely declines any approval request.
   */
  private handleServerInitiatedRequest(id: string, method: string, params: any): void {
    // Safely deny command execution, file changes, permissions, or any host mutations
    const declineResponse = {
      id,
      result: {
        decision: 'decline',
        status: 'denied',
        reason: 'Host mutations and shell executions are not permitted in prompt-only mode.',
      },
    };

    try {
      this.stdin.write(JSON.stringify(declineResponse) + '\n');
    } catch {}

    this.emit('serverRequestDenied', { id, method, params });
  }

  /**
   * Dispatches incoming server notifications to typed events.
   */
  private handleNotification(method: string, params: any): void {
    this.emit('notification', { method, params });

    switch (method) {
      case 'item/agentMessage/delta':
        this.emit('agentMessageDelta', params as CodexAgentMessageDeltaParams);
        break;
      case 'turn/completed':
        this.emit('turnCompleted', params as CodexTurnCompletedParams);
        break;
      case 'thread/tokenUsage/updated':
        this.emit('tokenUsageUpdated', params as CodexThreadTokenUsageUpdatedParams);
        break;
      case 'account/login/completed':
        this.emit('accountLoginCompleted', params as CodexAccountLoginCompletedParams);
        break;
      default:
        // Unknown or harness notifications are ignored safely
        break;
    }
  }

  private handleClose(): void {
    this.close('Codex App Server stream terminated');
  }

  /**
   * Sends an RPC request to the Codex App Server and waits for the response.
   */
  public sendRequest<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(new Error(`Cannot send request [${method}]: Codex App Server client is closed`));
    }

    const id = String(this.nextRequestId++);
    const payload = {
      id,
      method,
      params: params || {},
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex App Server request timed out after ${timeoutMs}ms [${method}]`));
      }, timeoutMs);
      timeoutTimer.unref();

      this.pendingRequests.set(id, {
        id,
        method,
        resolve,
        reject,
        timeoutTimer,
      });

      try {
        this.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        clearTimeout(timeoutTimer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  // --- High-level Typed RPC Methods ---

  public initialize(clientInfo?: Partial<CodexInitializeParams['clientInfo']>): Promise<CodexInitializeResponse> {
    const params: CodexInitializeParams = {
      clientInfo: {
        name: 'minfy',
        title: 'Minfy IDE',
        version: '0.1.0',
        ...clientInfo,
      },
      capabilities: null,
    };
    return this.sendRequest<CodexInitializeResponse>('initialize', params, 10000);
  }

  public getAccount(): Promise<CodexGetAccountResponse> {
    return this.sendRequest<CodexGetAccountResponse>('account/read', {}, 10000);
  }

  public startLogin(): Promise<CodexLoginAccountResponse> {
    return this.sendRequest<CodexLoginAccountResponse>('account/login/start', { type: 'chatgpt' }, 15000);
  }

  public cancelLogin(loginId: string): Promise<void> {
    return this.sendRequest<void>('account/login/cancel', { loginId }, 5000);
  }

  public listModels(): Promise<CodexModelListResponse> {
    return this.sendRequest<CodexModelListResponse>('model/list', {}, 15000);
  }

  public startThread(params: CodexThreadStartParams): Promise<CodexThreadStartResponse> {
    return this.sendRequest<CodexThreadStartResponse>('thread/start', params, 20000);
  }

  public startTurn(params: CodexTurnStartParams): Promise<CodexTurnStartResponse> {
    return this.sendRequest<CodexTurnStartResponse>('turn/start', params, 20000);
  }

  public interruptTurn(params: CodexTurnInterruptParams): Promise<void> {
    return this.sendRequest<void>('turn/interrupt', params, 10000);
  }
}
