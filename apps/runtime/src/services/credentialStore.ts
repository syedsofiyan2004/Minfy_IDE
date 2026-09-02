import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

export class CredentialStore {
  private credentialsFile: string;
  private credentials: Map<string, string> = new Map();

  constructor(filePath?: string) {
    this.credentialsFile = filePath || path.join(CONFIG.DATA_DIR, 'credentials.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.credentialsFile)) {
        const raw = fs.readFileSync(this.credentialsFile, 'utf-8');
        if (!raw || !raw.trim()) return;
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'string' && v.trim()) {
              this.credentials.set(k, v.trim());
            }
          }
        }
      }
    } catch (err) {
      console.warn('[CredentialStore] Could not load credentials file, starting empty');
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(CONFIG.DATA_DIR)) {
        fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
      }

      const obj: Record<string, string> = {};
      for (const [k, v] of this.credentials.entries()) {
        obj[k] = v;
      }

      fs.writeFileSync(this.credentialsFile, JSON.stringify(obj, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      });
    } catch (err) {
      console.error('[CredentialStore] Failed to save credentials file');
    }
  }

  public setCredential(providerId: string, apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      this.deleteCredential(providerId);
      return;
    }
    this.credentials.set(providerId, trimmed);
    this.save();
  }

  public getCredential(providerId: string): string | undefined {
    return this.credentials.get(providerId);
  }

  public hasCredential(providerId: string): boolean {
    return this.credentials.has(providerId) && Boolean(this.credentials.get(providerId));
  }

  public deleteCredential(providerId: string): boolean {
    const deleted = this.credentials.delete(providerId);
    if (deleted) {
      this.save();
    }
    return deleted;
  }
}

export const credentialStore = new CredentialStore();
