import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BedrockConfigService } from '../src/services/ai/bedrock/bedrockConfigService.js';

describe('AWS Bedrock Configuration & Secret Safety (Milestone 6)', () => {
  let tempDir: string;
  let configPath: string;
  let configService: BedrockConfigService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-bedrock-cfg-test-'));
    configPath = path.join(tempDir, 'bedrock.json');
    configService = new BedrockConfigService(configPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('saves and persists valid region and profile', () => {
    const saved = configService.saveConfig({
      region: 'us-east-1',
      profile: 'bedrock-dev',
    });

    assert.strictEqual(saved.region, 'us-east-1');
    assert.strictEqual(saved.profile, 'bedrock-dev');
    assert.strictEqual(saved.configured, true);

    const reloaded = configService.getConfig();
    assert.strictEqual(reloaded.region, 'us-east-1');
    assert.strictEqual(reloaded.profile, 'bedrock-dev');
    assert.strictEqual(reloaded.configured, true);
  });

  it('rejects forbidden secret keys (accessKey, secretKey, token) in config', () => {
    assert.throws(
      () => {
        configService.saveConfig({
          region: 'us-west-2',
          ...({ secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' } as any),
        });
      },
      /Security violation: AWS credentials cannot be stored in Minfy configuration/
    );

    assert.throws(
      () => {
        configService.saveConfig({
          region: 'us-west-2',
          ...({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE' } as any),
        });
      },
      /Security violation: AWS credentials cannot be stored in Minfy configuration/
    );
  });

  it('validates AWS Region format and rejects invalid formats', () => {
    assert.throws(() => {
      configService.saveConfig({ region: 'invalid_region!' });
    }, /Invalid AWS Region format/);

    assert.throws(() => {
      configService.saveConfig({ region: '' });
    }, /AWS Region must be a non-empty string/);
  });

  it('validates AWS Profile format and rejects dangerous characters', () => {
    assert.throws(() => {
      configService.saveConfig({ region: 'us-east-1', profile: 'bad profile; rm -rf' });
    }, /Invalid AWS Profile name/);
  });

  it('triggers onConfigChange listener when configuration updates', () => {
    let notified = false;
    const unsub = configService.onConfigChange((cfg) => {
      if (cfg.region === 'ap-south-1') {
        notified = true;
      }
    });

    configService.saveConfig({ region: 'ap-south-1' });
    assert.strictEqual(notified, true);
    unsub();
  });
});
