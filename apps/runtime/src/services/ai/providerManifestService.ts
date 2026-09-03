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

export const RESERVED_PROVIDER_IDS = new Set(['ollama', 'openrouter', 'bedrock']);
const FORBIDDEN_SECRET_KEYS = ['apikey', 'api_key', 'token', 'secret', 'password'];

// Strict forbidden header keys (case-insensitive)
export const FORBIDDEN_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'content-length',
  'host',
]);

const VALID_HEADER_TOKEN_REGEX = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/;

export interface ManifestValidationResult {
  valid: boolean;
  error?: string;
  manifest?: ProviderManifest;
}

/**
 * Centralized Provider ID validation helper.
 * Enforces /^[a-z0-9][a-z0-9._-]*$/ and path traversal resistance.
 */
export function assertValidProviderId(id: string): string {
  if (!id || typeof id !== 'string' || !id.trim()) {
    throw new Error('Provider ID is required.');
  }

  const cleanId = id.trim();
  const idRegex = /^[a-z0-9][a-z0-9._-]*$/;
  if (!idRegex.test(cleanId)) {
    throw new Error(
      `Invalid provider ID "${cleanId}". IDs must start with a lowercase alphanumeric character and contain only lowercase letters, digits, dots, underscores, or hyphens.`
    );
  }

  if (cleanId.includes('/') || cleanId.includes('\\') || cleanId.includes('..')) {
    throw new Error('Provider ID cannot contain path traversal or slash characters.');
  }

  return cleanId;
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
   * Resolves and verifies that a target manifest path remains strictly inside providersDir.
   */
  public resolveManifestPath(id: string): string {
    const cleanId = assertValidProviderId(id);
    const providersRoot = path.resolve(this.providersDir);
    const targetFile = path.resolve(providersRoot, `${cleanId}.json`);

    const isWindows = os.platform() === 'win32';
    const normRoot = isWindows ? providersRoot.toLowerCase() : providersRoot;
    const normTarget = isWindows ? targetFile.toLowerCase() : targetFile;

    if (!normTarget.startsWith(normRoot + path.sep)) {
      throw new Error(`Path traversal detected: provider ID "${cleanId}" escapes providers directory.`);
    }

    return targetFile;
  }

  /**
   * Validate a manifest object according to Milestone 5 & 5.1 schema and security rules.
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

    // 2. Reject obvious secret fields in root object
    for (const key of Object.keys(raw)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_SECRET_KEYS.includes(lowerKey)) {
        return {
          valid: false,
          error: `Manifest must not contain secret fields like "${key}". Store API credentials in CredentialStore.`,
        };
      }
    }

    // 3. Provider ID validation (Centralized)
    let cleanId: string;
    try {
      cleanId = assertValidProviderId(raw.id);
    } catch (err: any) {
      return { valid: false, error: err.message };
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

    // 6. Provider Type (Reject invalid explicit types rather than silently defaulting)
    const validTypes: AIProviderType[] = ['local', 'api', 'subscription', 'enterprise', 'router'];
    let cleanType: AIProviderType = 'api';
    if (raw.providerType !== undefined && raw.providerType !== null) {
      if (typeof raw.providerType !== 'string' || !validTypes.includes(raw.providerType as AIProviderType)) {
        return {
          valid: false,
          error: `Invalid provider type "${raw.providerType}". Allowed values are: ${validTypes.join(', ')}.`,
        };
      }
      cleanType = raw.providerType as AIProviderType;
    }

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

    // 9. Endpoints validation (relative path normalization & escape check)
    let endpoints: ProviderManifest['endpoints'] = undefined;
    if (raw.endpoints && typeof raw.endpoints === 'object') {
      endpoints = {};
      const validateEndpointPath = (fieldName: string, epValue: any): string | null => {
        if (typeof epValue !== 'string' || !epValue.trim()) {
          return `Endpoint "${fieldName}" must be a non-empty string.`;
        }
        const trimmed = epValue.trim();

        // Reject network path references (//) or full URLs (://)
        if (trimmed.includes('://') || trimmed.startsWith('//')) {
          return `Endpoint "${fieldName}" must be a relative path, not a full URL or network path.`;
        }

        // Reject backslashes
        if (trimmed.includes('\\')) {
          return `Endpoint "${fieldName}" cannot contain backslash characters.`;
        }

        // Reject control characters or whitespace
        if (/[\r\n\t\0]/.test(trimmed)) {
          return `Endpoint "${fieldName}" contains invalid control characters.`;
        }

        // Reject path traversal components (.. / /..)
        if (trimmed.includes('..')) {
          return `Endpoint "${fieldName}" cannot contain ".." traversal components.`;
        }

        // Normalize using POSIX path semantics
        const normalized = path.posix.normalize(trimmed);
        if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/../')) {
          return `Endpoint "${fieldName}" cannot traverse outside the base path boundary.`;
        }

        return null;
      };

      if (raw.endpoints.models !== undefined) {
        const err = validateEndpointPath('models', raw.endpoints.models);
        if (err) return { valid: false, error: err };
        endpoints.models = raw.endpoints.models.trim();
      }

      if (raw.endpoints.chatCompletions !== undefined) {
        const err = validateEndpointPath('chatCompletions', raw.endpoints.chatCompletions);
        if (err) return { valid: false, error: err };
        endpoints.chatCompletions = raw.endpoints.chatCompletions.trim();
      }
    }

    // 10. Custom Headers (sanitize, reject forbidden credential headers, reject CRLF injection)
    let customHeaders: Record<string, string> | undefined = undefined;
    if (raw.customHeaders && typeof raw.customHeaders === 'object' && !Array.isArray(raw.customHeaders)) {
      customHeaders = {};
      for (const [hKey, hVal] of Object.entries(raw.customHeaders)) {
        if (typeof hVal !== 'string') continue;
        const trimmedKey = hKey.trim();
        const lowerHKey = trimmedKey.toLowerCase();

        // Verify valid HTTP header token chars
        if (!VALID_HEADER_TOKEN_REGEX.test(trimmedKey)) {
          return {
            valid: false,
            error: `Custom header name "${hKey}" contains invalid header token characters.`,
          };
        }

        // Reject forbidden credential and security headers
        if (FORBIDDEN_HEADER_KEYS.has(lowerHKey)) {
          return {
            valid: false,
            error: `Custom header "${hKey}" is forbidden. Security and credential headers cannot be specified in manifests.`,
          };
        }

        // Reject CRLF header injection in values
        if (/[\r\n]/.test(hVal)) {
          return {
            valid: false,
            error: `Custom header "${hKey}" value contains invalid newline characters (CR/LF injection attempt).`,
          };
        }

        customHeaders[trimmedKey] = hVal.trim();
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
   * Path containment is enforced locally.
   */
  public getManifest(id: string): ProviderManifest | null {
    const filePath = this.resolveManifestPath(id);
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
   * Path containment is enforced locally.
   */
  public saveManifest(manifest: ProviderManifest): void {
    this.ensureDir();
    const targetFile = this.resolveManifestPath(manifest.id);
    const tempFile = path.resolve(this.providersDir, `.${manifest.id}.${Date.now()}.tmp`);

    const json = JSON.stringify(manifest, null, 2);

    try {
      fs.writeFileSync(tempFile, json, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempFile, targetFile);
    } catch (err: any) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      throw new Error(`Failed to save provider manifest "${manifest.id}": ${err.message}`);
    }
  }

  /**
   * Delete a manifest file.
   * Path containment is enforced locally.
   */
  public deleteManifest(id: string): boolean {
    const filePath = this.resolveManifestPath(id);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err: any) {
        throw new Error(`Failed to delete manifest "${id}": ${err.message}`);
      }
    }

    return false;
  }
}

export const providerManifestService = new ProviderManifestService();
