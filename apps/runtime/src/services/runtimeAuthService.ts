import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG } from '../config.js';

export interface RuntimeState {
  port: number;
  pid: number;
  token: string;
  runtimeInstanceId: string;
  startedAt: string;
}

export class RuntimeAuthService {
  private token: string;
  private runtimeInstanceId: string;
  private stateFilePath: string;

  constructor(customToken?: string, statePath?: string, customInstanceId?: string) {
    this.token = customToken || crypto.randomBytes(32).toString('hex');
    this.runtimeInstanceId = customInstanceId || crypto.randomUUID();
    this.stateFilePath = statePath || path.join(CONFIG.DATA_DIR, 'runtime-state.json');
  }

  public getToken(): string {
    return this.token;
  }

  public getRuntimeInstanceId(): string {
    return this.runtimeInstanceId;
  }

  public verifyToken(candidate?: string): boolean {
    if (!candidate || typeof candidate !== 'string') {
      return false;
    }
    const clean = candidate.trim();
    if (clean.length !== this.token.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(this.token));
    } catch {
      return false;
    }
  }

  public saveRuntimeState(port: number = CONFIG.PORT): void {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }

    const state: RuntimeState = {
      port,
      pid: process.pid,
      token: this.token,
      runtimeInstanceId: this.runtimeInstanceId,
      startedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      });
    } catch (err: any) {
      throw new Error(`Failed to initialize secure runtime state file: ${err.message}`);
    }
  }

  public cleanup(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const existingState = JSON.parse(raw);
        // Only delete if the state file belongs to THIS specific runtime instance
        if (
          existingState &&
          existingState.pid === process.pid &&
          existingState.token === this.token &&
          existingState.runtimeInstanceId === this.runtimeInstanceId
        ) {
          fs.unlinkSync(this.stateFilePath);
        }
      }
    } catch {}
  }
}

export const runtimeAuthService = new RuntimeAuthService();
