import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ProviderManifest,
  AIProviderType,
  AIExecutionLocation,
  AIBillingType,
} from '@minfy/shared';
import { CONFIG } from '../../config.js';

export const RESERVED_PROVIDER_IDS = new Set(['ollama', 'openrouter']);
const FORBIDDEN_SECRET_KEYS = ['apikey', 'api_key', 'token', 'secret', 'password'];
const FORBIDDEN_HEADER_KEYS = [
  'authorization',
  'content-length',
  'host',
  'cookie',
  'proxy-authorization',
];

export interface ManifestValidationResult {
  valid: boolean;
  error?: string;
  manifest?: ProviderManifest;
}

export class ProviderManifestService {
  private providersDir: string;

  constructor(customDir?: string) {
    this.providersDir = customDir || path.join(CONFIG.DATA_DIR, 'providers');
  }

  public getProvidersDir(): string {
    return this.providersDir;
  }

  public ensureDir(): void {
    if (!fs.existsSync(this.providersDir)) {
      fs.mkdirSync(this.providersDir, { recursive: true });
    }
  }

  /**
   * Validate a manifest object according to Milestone 5 schema & security rules.
   */
  public validateManifest(raw: any, isBuiltInIdCheck = true): ManifestValidationResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, error: 'Manifest must be a non-empty object.' };
    }

    // 1. Schema Version
    if (raw.schemaVersion !== 1) {
      return {
        valid: false,
        error: `Unsupported provider manifest schema version: ${raw.schemaVersion ?? 'undefined'}. Only version 1 is supported.`,
      };
    }

    // 2. Reject obvious secret fields
    for (const key of Object.keys(raw)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_SECRET_KEYS.includes(lowerKey)) {
        return {
          valid: false,
          error: `Manifest must not contain secret fields like "${key}". Store API credentials in CredentialStore.`,
        };
      }
    }

    // 3. Provider ID validation
    if (!raw.id || typeof raw.id !== 'string' || !raw.id.trim()) {
      return { valid: false, error: 'Provider ID is required.' };
    }
    const cleanId = raw.id.trim();
    const idRegex = /^[a-z0-9][a-z0-9._-]*$/;
    if (!idRegex.test(cleanId)) {
      return {
        valid: false,
        error: `Invalid provider ID "${cleanId}". IDs must start with a lowercase alphanumeric character and contain only lowercase letters, digits, dots, underscores, or hyphens.`,
      };
    }
    if (cleanId.includes('/') || cleanId.includes('\\') || cleanId.includes('..')) {
      return { valid: false, error: 'Provider ID cannot contain path traversal or slash characters.' };
    }

    if (isBuiltInIdCheck && RESERVED_PROVIDER_IDS.has(cleanId)) {
      return {
        valid: false,
        error: `Provider ID "${cleanId}" is reserved for built-in providers and cannot be used for custom providers.`,
      };
    }

    // 4. Provider Name
    if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) {
      return { valid: false, error: 'Provider name is required.' };
    }
    const cleanName = raw.name.trim();

    // 5. Protocol
    if (raw.protocol !== 'openai-compatible') {
      return {
        valid: false,
        error: `Unsupported protocol "${raw.protocol}". Milestone 5 supports "openai-compatible" only.`,
      };
    }

    // 6. Provider Type
    const validTypes: AIProviderType[] = ['local', 'api', 'subscription', 'enterprise', 'router'];
    const cleanType: AIProviderType = validTypes.includes(raw.providerType) ? raw.providerType : 'api';

    // 7. Base URL validation
    if (!raw.baseUrl || typeof raw.baseUrl !== 'string' || !raw.baseUrl.trim()) {
      return { valid: false, error: 'Base URL is required.' };
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(raw.baseUrl.trim());
    } catch {
      return { valid: false, error: `Invalid Base URL: "${raw.baseUrl}". Must be a valid HTTP or HTTPS URL.` };
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        valid: false,
        error: `Unsupported URL protocol "${parsedUrl.protocol}". Only "http:" and "https:" are allowed.`,
      };
    }

    if (parsedUrl.username || parsedUrl.password) {
      return {
        valid: false,
        error: 'Base URL must not contain embedded username or password credentials.',
      };
    }

    // Link-local / cloud metadata protection (e.g. 169.254.x.x)
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data'
    ) {
      return {
        valid: false,
        error: `Forbidden Base URL target: "${hostname}" is a reserved link-local metadata address.`,
      };
    }

    const cleanBaseUrl = raw.baseUrl.trim().replace(/\/+$/, '');

    // 8. Auth specification
    if (!raw.auth || typeof raw.auth !== 'object') {
      return { valid: false, error: 'Provider auth configuration is required.' };
    }
    if (raw.auth.type !== 'none' && raw.auth.type !== 'bearer') {
      return {
        valid: false,
        error: `Unsupported auth type "${raw.auth.type}". Allowed values are "none" or "bearer".`,
      };
    }

    // Check if auth object has secrets
    for (const key of Object.keys(raw.auth)) {
      if (FORBIDDEN_SECRET_KEYS.includes(key.toLowerCase())) {
        return {
          valid: false,
          error: `Auth config must not contain secret fields like "${key}".`,
        };
      }
    }

    // 9. Endpoints validation (must be relative paths, no host-escape)
    let endpoints: ProviderManifest['endpoints'] = undefined;
    if (raw.endpoints && typeof raw.endpoints === 'object') {
      endpoints = {};
      if (raw.endpoints.models) {
        if (typeof raw.endpoints.models !== 'string' || raw.endpoints.models.includes('://')) {
          return { valid: false, error: 'Endpoint "models" must be a relative path, not a full URL.' };
        }
        endpoints.models = raw.endpoints.models.trim();
      }
      if (raw.endpoints.chatCompletions) {
        if (typeof raw.endpoints.chatCompletions !== 'string' || raw.endpoints.chatCompletions.includes('://')) {
          return { valid: false, error: 'Endpoint "chatCompletions" must be a relative path, not a full URL.' };
        }
        endpoints.chatCompletions = raw.endpoints.chatCompletions.trim();
      }
    }

    // 10. Custom Headers (sanitize and reject forbidden headers)
    let customHeaders: Record<string, string> | undefined = undefined;
    if (raw.customHeaders && typeof raw.customHeaders === 'object' && !Array.isArray(raw.customHeaders)) {
      customHeaders = {};
      for (const [hKey, hVal] of Object.entries(raw.customHeaders)) {
        if (typeof hVal !== 'string') continue;
        const lowerHKey = hKey.trim().toLowerCase();
        if (FORBIDDEN_HEADER_KEYS.includes(lowerHKey)) {
          return {
            valid: false,
            error: `Custom header "${hKey}" is forbidden. Security headers cannot be specified in manifests.`,
          };
        }
        customHeaders[hKey.trim()] = hVal.trim();
      }
    }

    // 11. Defaults
    let defaults: ProviderManifest['defaults'] = undefined;
    if (raw.defaults && typeof raw.defaults === 'object') {
      const validLocations: AIExecutionLocation[] = ['local', 'cloud', 'hybrid', 'unknown'];
      const validBillings: AIBillingType[] = ['local', 'free', 'subscription', 'metered', 'unknown'];

      defaults = {
        executionLocation: validLocations.includes(raw.defaults.executionLocation)
          ? raw.defaults.executionLocation
          : 'unknown',
        billingType: validBillings.includes(raw.defaults.billingType)
          ? raw.defaults.billingType
          : 'unknown',
      };
    } else {
      defaults = {
        executionLocation: 'unknown',
        billingType: 'unknown',
      };
    }

    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: cleanId,
      name: cleanName,
      protocol: 'openai-compatible',
      providerType: cleanType,
      baseUrl: cleanBaseUrl,
      auth: {
        type: raw.auth.type,
        required: raw.auth.type === 'bearer' ? (raw.auth.required ?? true) : false,
      },
      endpoints,
      defaults,
      customHeaders,
      enabled: raw.enabled !== false,
      source: 'custom',
    };

    return { valid: true, manifest };
  }

  /**
   * List all saved custom manifests in ~/.minfy/providers/
   * Non-blocking and fault-tolerant: skips corrupt files with a logged warning.
   */
  public listManifests(): ProviderManifest[] {
    this.ensureDir();
    const manifests: ProviderManifest[] = [];

    try {
      const files = fs.readdirSync(this.providersDir);
      for (const file of files) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue;

        const fullPath = path.join(this.providersDir, file);
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          const result = this.validateManifest(parsed, false);

          if (result.valid && result.manifest) {
            manifests.push(result.manifest);
          } else {
            console.warn(`[ProviderManifestService] Provider manifest "${file}" could not be loaded: ${result.error}`);
          }
        } catch (err: any) {
          console.warn(`[ProviderManifestService] Provider manifest "${file}" could not be loaded: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[ProviderManifestService] Failed to read providers directory: ${err.message}`);
    }

    return manifests;
  }

  /**
   * Get a single manifest by ID.
   */
  public getManifest(id: string): ProviderManifest | null {
    const cleanId = id.trim().toLowerCase();
    const filePath = path.join(this.providersDir, `${cleanId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = this.validateManifest(parsed, false);
      if (result.valid && result.manifest) {
        return result.manifest;
      }
    } catch {}

    return null;
  }

  /**
   * Save a manifest atomically.
   */
  public saveManifest(manifest: ProviderManifest): void {
    this.ensureDir();
    const cleanId = manifest.id.trim().toLowerCase();
    const targetFile = path.join(this.providersDir, `${cleanId}.json`);
    const tempFile = path.join(this.providersDir, `.${cleanId}.${Date.now()}.tmp`);

    const json = JSON.stringify(manifest, null, 2);

    try {
      fs.writeFileSync(tempFile, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempFile, targetFile);
    } catch (err: any) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      throw new Error(`Failed to save provider manifest "${cleanId}": ${err.message}`);
    }
  }

  /**
   * Delete a manifest file.
   */
  public deleteManifest(id: string): boolean {
    const cleanId = id.trim().toLowerCase();
    const filePath = path.join(this.providersDir, `${cleanId}.json`);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err: any) {
        throw new Error(`Failed to delete manifest "${cleanId}": ${err.message}`);
      }
    }

    return false;
  }
}

export const providerManifestService = new ProviderManifestService();
