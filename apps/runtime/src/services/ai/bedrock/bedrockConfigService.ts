import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BedrockConfig } from '@minfy/shared';
import { CONFIG } from '../../../config.js';

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
   * Try detecting AWS default region from environment or ~/.aws/config
   */
  public detectDefaultRegion(): string | undefined {
    if (process.env.AWS_REGION && /^[a-z]{2}-[a-z]+-\d+$/.test(process.env.AWS_REGION.trim())) {
      return process.env.AWS_REGION.trim();
    }
    if (process.env.AWS_DEFAULT_REGION && /^[a-z]{2}-[a-z]+-\d+$/.test(process.env.AWS_DEFAULT_REGION.trim())) {
      return process.env.AWS_DEFAULT_REGION.trim();
    }

    try {
      const awsConfigPath = path.join(os.homedir(), '.aws', 'config');
      if (fs.existsSync(awsConfigPath)) {
        const content = fs.readFileSync(awsConfigPath, 'utf-8');
        const match = content.match(/region\s*=\s*([a-z]{2}-[a-z]+-\d+)/i);
        if (match && match[1]) {
          return match[1].trim().toLowerCase();
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

      let region = typeof parsed.region === 'string' ? parsed.region.trim() : undefined;
      let profile = typeof parsed.profile === 'string' && parsed.profile.trim() ? parsed.profile.trim() : undefined;

      if (!region) {
        region = this.detectDefaultRegion();
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
      // Validate AWS region format e.g. us-east-1, ap-south-1, eu-central-1
      const regionRegex = /^[a-z]{2}-[a-z]+-\d+$/;
      if (!regionRegex.test(trimmedRegion)) {
        throw new Error(`Invalid AWS Region format "${newConfig.region}". Expected e.g. "us-east-1", "ap-south-1".`);
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
