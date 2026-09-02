import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG } from '../config.js';

export interface RuntimeState {
  port: number;
  pid: number;
  token: string;
  startedAt: string;
}

export class RuntimeAuthService {
  private token: string;
  private stateFilePath: string;

  constructor(customToken?: string, statePath?: string) {
    this.token = customToken || crypto.randomBytes(32).toString('hex');
    this.stateFilePath = statePath || path.join(CONFIG.DATA_DIR, 'runtime-state.json');
  }

  public getToken(): string {
    return this.token;
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
    try {
      if (!fs.existsSync(CONFIG.DATA_DIR)) {
        fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
      }

      const state: RuntimeState = {
        port,
        pid: process.pid,
        token: this.token,
        startedAt: new Date().toISOString(),
      };

      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      });
    } catch (err) {
      console.warn('[RuntimeAuthService] Could not save runtime state file:', err);
    }
  }

  public cleanup(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
    } catch {}
  }
}

export const runtimeAuthService = new RuntimeAuthService();
