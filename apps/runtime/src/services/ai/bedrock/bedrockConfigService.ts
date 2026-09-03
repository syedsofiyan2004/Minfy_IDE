import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BedrockConfig } from '@minfy/shared';
import { CONFIG } from '../../../config.js';

/**
 * Validates whether a string is a syntactically safe AWS region identifier.
 * Allows standard regions (us-east-1, ap-south-1), govcloud (us-gov-west-1),
 * China (cn-north-1), ISO regions, and future safe identifiers.
 * Rejects whitespace, slashes, URLs, control characters, and invalid lengths.
 */
export function isValidAwsRegion(region: string): boolean {
  if (!region || typeof region !== 'string') return false;
  if (region !== region.trim()) return false;
  const trimmed = region.toLowerCase();
  // Safe AWS region identifier: 3 to 32 characters, lowercase alphanumeric and hyphens,
  // starts and ends with alphanumeric character, no consecutive hyphens.
  if (!/^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('--') || trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }
  return true;
}

export class BedrockConfigService {
  private configPath: string;
  private onConfigChangeCallbacks: Array<(config: BedrockConfig) => void> = [];

  constructor(customPath?: string) {
    this.configPath = customPath || path.join(CONFIG.DATA_DIR, 'bedrock.json');
  }

  public onConfigChange(callback: (config: BedrockConfig) => void): () => void {
    this.onConfigChangeCallbacks.push(callback);
    return () => {
      this.onConfigChangeCallbacks = this.onConfigChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  private notifyChange(config: BedrockConfig): void {
    for (const cb of this.onConfigChangeCallbacks) {
      try {
        cb(config);
      } catch (err) {
        console.warn('[BedrockConfigService] Error in change listener:', err);
      }
    }
  }

  /**
   * Try detecting AWS default region from environment or profile-specific section in ~/.aws/config
   */
  public detectDefaultRegion(profile?: string): string | undefined {
    // 1. Check standard AWS environment variables
    if (process.env.AWS_REGION && isValidAwsRegion(process.env.AWS_REGION.trim())) {
      return process.env.AWS_REGION.trim().toLowerCase();
    }
    if (process.env.AWS_DEFAULT_REGION && isValidAwsRegion(process.env.AWS_DEFAULT_REGION.trim())) {
      return process.env.AWS_DEFAULT_REGION.trim().toLowerCase();
    }

    // 2. Profile-aware ~/.aws/config parsing (strictly isolated by section)
    try {
      const awsConfigPath = path.join(os.homedir(), '.aws', 'config');
      if (fs.existsSync(awsConfigPath)) {
        const content = fs.readFileSync(awsConfigPath, 'utf-8');
        const lines = content.split('\n');
        const targetSection = profile && profile !== 'default' ? `profile ${profile}` : 'default';

        let currentSection: string | null = null;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            currentSection = trimmed.slice(1, -1).trim();
            continue;
          }

          if (currentSection && currentSection.toLowerCase() === targetSection.toLowerCase()) {
            const match = trimmed.match(/^region\s*=\s*(.+)$/i);
            if (match && match[1]) {
              const reg = match[1].trim().toLowerCase();
              if (isValidAwsRegion(reg)) {
                return reg;
              }
            }
          }
        }
      }
    } catch {}

    return undefined;
  }

  /**
   * Reads saved configuration from ~/.minfy/bedrock.json
   */
  public getConfig(): BedrockConfig {
    if (!fs.existsSync(this.configPath)) {
      const detected = this.detectDefaultRegion();
      return {
        region: detected,
        profile: undefined,
        configured: Boolean(detected),
      };
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      let region = typeof parsed.region === 'string' ? parsed.region.trim().toLowerCase() : undefined;
      let profile = typeof parsed.profile === 'string' && parsed.profile.trim() ? parsed.profile.trim() : undefined;

      if (!region) {
        region = this.detectDefaultRegion(profile);
      }

      return {
        region,
        profile,
        configured: Boolean(region),
      };
    } catch (err: any) {
      console.warn(`[BedrockConfigService] Failed to read bedrock.json: ${err.message}`);
      const detected = this.detectDefaultRegion();
      return {
        region: detected,
        profile: undefined,
        configured: Boolean(detected),
      };
    }
  }

  /**
   * Persists non-secret configuration atomically with mode 0o600.
   */
  public saveConfig(newConfig: { region?: string; profile?: string }): BedrockConfig {
    // 1. Validate region
    let cleanRegion: string | undefined = undefined;
    if (newConfig.region !== undefined && newConfig.region !== null) {
      if (typeof newConfig.region !== 'string' || !newConfig.region.trim()) {
        throw new Error('AWS Region must be a non-empty string.');
      }
      const trimmedRegion = newConfig.region.trim().toLowerCase();
      if (!isValidAwsRegion(trimmedRegion)) {
        throw new Error(`Invalid AWS Region format "${newConfig.region}". Expected a valid identifier e.g. "us-east-1", "us-gov-west-1", "ap-south-1".`);
      }
      cleanRegion = trimmedRegion;
    }

    // 2. Validate profile
    let cleanProfile: string | undefined = undefined;
    if (newConfig.profile !== undefined && newConfig.profile !== null) {
      if (typeof newConfig.profile !== 'string') {
        throw new Error('AWS Profile must be a string.');
      }
      const trimmedProfile = newConfig.profile.trim();
      if (trimmedProfile) {
        // Enforce safe profile identifier
        const profileRegex = /^[a-zA-Z0-9._-]+$/;
        if (!profileRegex.test(trimmedProfile)) {
          throw new Error(`Invalid AWS Profile name "${newConfig.profile}". Only alphanumeric characters, dots, underscores, and hyphens are allowed.`);
        }
        cleanProfile = trimmedProfile;
      }
    }

    // Explicitly ensure NO secret fields can ever be stored
    const forbiddenKeys = ['accessKey', 'secretKey', 'secretAccessKey', 'token', 'sessionToken', 'password'];
    for (const key of Object.keys(newConfig)) {
      if (forbiddenKeys.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        throw new Error(`Security violation: AWS credentials cannot be stored in Minfy configuration.`);
      }
    }

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload = {
      region: cleanRegion,
      profile: cleanProfile,
    };

    const tempPath = path.join(dir, `.bedrock.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempPath, this.configPath);
    } catch (err: any) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw new Error(`Failed to write Bedrock config: ${err.message}`);
    }

    const resolved: BedrockConfig = {
      region: cleanRegion,
      profile: cleanProfile,
      configured: Boolean(cleanRegion),
    };

    this.notifyChange(resolved);
    return resolved;
  }
}

export const bedrockConfigService = new BedrockConfigService();
