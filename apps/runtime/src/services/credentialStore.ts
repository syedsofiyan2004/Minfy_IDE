import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config.js';

const execFileAsync = promisify(execFile);

export type CredentialBackendType =
  | 'windows-credential-manager'
  | 'macos-keychain'
  | 'linux-secret-service'
  | 'memory'
  | 'development-file';

export interface CredentialBackendInfo {
  type: CredentialBackendType;
  name: string;
  isPersistent: boolean;
}

export interface ICredentialBackend {
  readonly type: CredentialBackendType;
  readonly name: string;
  readonly isPersistent: boolean;
  get(providerId: string): Promise<string | null>;
  set(providerId: string, credential: string): Promise<void>;
  delete(providerId: string): Promise<boolean>;
  has(providerId: string): Promise<boolean>;
}

/**
 * In-Memory Credential Backend (Session Only)
 */
export class MemoryCredentialBackend implements ICredentialBackend {
  public readonly type = 'memory' as const;
  public readonly name = 'Session Memory';
  public readonly isPersistent = false;
  private store = new Map<string, string>();

  public async get(providerId: string): Promise<string | null> {
    return this.store.get(providerId) || null;
  }

  public async set(providerId: string, credential: string): Promise<void> {
    const trimmed = credential.trim();
    if (!trimmed) {
      this.store.delete(providerId);
      return;
    }
    this.store.set(providerId, trimmed);
  }

  public async delete(providerId: string): Promise<boolean> {
    return this.store.delete(providerId);
  }

  public async has(providerId: string): Promise<boolean> {
    return this.store.has(providerId) && Boolean(this.store.get(providerId));
  }
}

/**
 * Windows DPAPI / Credential Manager Backend
 * Uses OS-level DPAPI (Data Protection API) scoped to CurrentUser.
 */
export class WindowsCredentialBackend implements ICredentialBackend {
  public readonly type = 'windows-credential-manager' as const;
  public readonly name = 'Windows Credential Manager (DPAPI)';
  public readonly isPersistent = true;

  private encFile: string;
  private cache = new Map<string, string>();

  constructor(filePath?: string) {
    this.encFile = filePath || path.join(CONFIG.DATA_DIR, 'vault.dpapi');
    this.initSync();
  }

  private initSync(): void {
    try {
      if (fs.existsSync(this.encFile)) {
        const raw = fs.readFileSync(this.encFile, 'utf-8');
        if (raw) {
          const map = JSON.parse(raw);
          for (const [k, v] of Object.entries(map)) {
            if (typeof v === 'string') {
              this.cache.set(k, v);
            }
          }
        }
      }
    } catch {}
  }

  private async encryptString(plain: string): Promise<string> {
    const base64Input = Buffer.from(plain, 'utf-8').toString('base64');
    const psScript = `
      Add-Type -AssemblyName System.Security
      $bytes = [Convert]::FromBase64String('${base64Input}')
      $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($enc)
    `.trim();

    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    return stdout.trim();
  }

  private async decryptString(encBase64: string): Promise<string> {
    const psScript = `
      Add-Type -AssemblyName System.Security
      $bytes = [Convert]::FromBase64String('${encBase64.trim()}')
      $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Text.Encoding]::UTF8.GetString($dec)
    `.trim();

    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    return stdout.trim();
  }

  private saveFile(): void {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }
    const obj: Record<string, string> = {};
    for (const [k, v] of this.cache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(this.encFile, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  public async get(providerId: string): Promise<string | null> {
    const enc = this.cache.get(providerId);
    if (!enc) return null;
    try {
      return await this.decryptString(enc);
    } catch {
      return null;
    }
  }

  public async set(providerId: string, credential: string): Promise<void> {
    const trimmed = credential.trim();
    if (!trimmed) {
      await this.delete(providerId);
      return;
    }
    const enc = await this.encryptString(trimmed);
    this.cache.set(providerId, enc);
    this.saveFile();
  }

  public async delete(providerId: string): Promise<boolean> {
    const deleted = this.cache.delete(providerId);
    if (deleted) {
      this.saveFile();
    }
    return deleted;
  }

  public async has(providerId: string): Promise<boolean> {
    return this.cache.has(providerId);
  }
}

/**
 * macOS Keychain Backend
 */
export class MacOSKeychainBackend implements ICredentialBackend {
  public readonly type = 'macos-keychain' as const;
  public readonly name = 'macOS Keychain';
  public readonly isPersistent = true;
  private service = 'minfy-ide';

  public async get(providerId: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        this.service,
        '-a',
        providerId,
        '-w',
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async set(providerId: string, credential: string): Promise<void> {
    await this.delete(providerId).catch(() => {});
    await execFileAsync('security', [
      'add-generic-password',
      '-s',
      this.service,
      '-a',
      providerId,
      '-w',
      credential.trim(),
      '-U',
    ]);
  }

  public async delete(providerId: string): Promise<boolean> {
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', this.service, '-a', providerId]);
      return true;
    } catch {
      return false;
    }
  }

  public async has(providerId: string): Promise<boolean> {
    const val = await this.get(providerId);
    return Boolean(val);
  }
}

/**
 * Linux Secret Service Backend
 */
export class LinuxSecretServiceBackend implements ICredentialBackend {
  public readonly type = 'linux-secret-service' as const;
  public readonly name = 'Linux Secret Service';
  public readonly isPersistent = true;

  public async get(providerId: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('secret-tool', ['lookup', 'service', 'minfy-ide', 'provider', providerId]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async set(providerId: string, credential: string): Promise<void> {
    const child = execFile('secret-tool', [
      'store',
      '--label',
      `Minfy IDE ${providerId}`,
      'service',
      'minfy-ide',
      'provider',
      providerId,
    ]);
    if (child.stdin) {
      child.stdin.write(credential.trim());
      child.stdin.end();
    }
    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`secret-tool exited ${code}`))));
      child.on('error', reject);
    });
  }

  public async delete(providerId: string): Promise<boolean> {
    try {
      await execFileAsync('secret-tool', ['clear', 'service', 'minfy-ide', 'provider', providerId]);
      return true;
    } catch {
      return false;
    }
  }

  public async has(providerId: string): Promise<boolean> {
    const val = await this.get(providerId);
    return Boolean(val);
  }
}

/**
 * CredentialStore Facade & Factory
 */
export class CredentialStore {
  private backend: ICredentialBackend;
  private memoryCache = new Map<string, string>();

  constructor(backend?: ICredentialBackend) {
    if (backend) {
      this.backend = backend;
    } else {
      this.backend = this.resolveDefaultBackend();
    }
  }

  private resolveDefaultBackend(): ICredentialBackend {
    const envChoice = process.env.MINFY_CREDENTIAL_STORAGE;
    if (envChoice === 'memory') {
      return new MemoryCredentialBackend();
    }

    try {
      if (os.platform() === 'win32') {
        return new WindowsCredentialBackend();
      }
      if (os.platform() === 'darwin') {
        return new MacOSKeychainBackend();
      }
      if (os.platform() === 'linux') {
        return new LinuxSecretServiceBackend();
      }
    } catch (err) {
      console.warn('[CredentialStore] Native OS keyring unavailable, using Session Memory fallback');
    }

    return new MemoryCredentialBackend();
  }

  public async get(providerId: string): Promise<string | null> {
    if (this.memoryCache.has(providerId)) {
      return this.memoryCache.get(providerId) || null;
    }
    const val = await this.backend.get(providerId);
    if (val) {
      this.memoryCache.set(providerId, val);
    }
    return val;
  }

  public async set(providerId: string, credential: string): Promise<void> {
    const trimmed = credential.trim();
    if (!trimmed) {
      await this.delete(providerId);
      return;
    }
    this.memoryCache.set(providerId, trimmed);
    try {
      await this.backend.set(providerId, trimmed);
    } catch (err: any) {
      console.warn(`[CredentialStore] Failed to write to native backend (${err.message}), retaining in session memory`);
    }
  }

  public async delete(providerId: string): Promise<boolean> {
    this.memoryCache.delete(providerId);
    try {
      return await this.backend.delete(providerId);
    } catch {
      return false;
    }
  }

  public async has(providerId: string): Promise<boolean> {
    if (this.memoryCache.has(providerId)) {
      return Boolean(this.memoryCache.get(providerId));
    }
    return this.backend.has(providerId);
  }

  public backendInfo(): CredentialBackendInfo {
    return {
      type: this.backend.type,
      name: this.backend.name,
      isPersistent: this.backend.isPersistent,
    };
  }

  // Synchronous convenience methods for hot-path adapters
  public getCredential(providerId: string): string | undefined {
    return this.memoryCache.get(providerId);
  }

  public hasCredential(providerId: string): boolean {
    return this.memoryCache.has(providerId) && Boolean(this.memoryCache.get(providerId));
  }

  public setCredential(providerId: string, credential: string): void {
    const trimmed = credential.trim();
    if (!trimmed) {
      this.deleteCredential(providerId);
      return;
    }
    this.memoryCache.set(providerId, trimmed);
    this.backend.set(providerId, trimmed).catch(() => {});
  }

  public deleteCredential(providerId: string): boolean {
    this.memoryCache.delete(providerId);
    this.backend.delete(providerId).catch(() => {});
    return true;
  }

  public async loadInitialCredentials(providerIds: string[]): Promise<void> {
    for (const id of providerIds) {
      try {
        const val = await this.backend.get(id);
        if (val) {
          this.memoryCache.set(id, val);
        }
      } catch {}
    }
  }
}

export const credentialStore = new CredentialStore();
