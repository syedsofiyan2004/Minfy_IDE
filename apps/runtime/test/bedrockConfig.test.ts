import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BedrockConfigService, isValidAwsRegion } from '../src/services/ai/bedrock/bedrockConfigService.js';

describe('AWS Bedrock Configuration & Secret Safety (Milestones 6, 6.1 & 6.1.1)', () => {
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

  it('accepts valid AWS regions including GovCloud syntactically', () => {
    assert.strictEqual(isValidAwsRegion('us-east-1'), true);
    assert.strictEqual(isValidAwsRegion('ap-south-1'), true);
    assert.strictEqual(isValidAwsRegion('us-gov-west-1'), true);
    assert.strictEqual(isValidAwsRegion('cn-north-1'), true);

    const saved = configService.saveConfig({ region: 'us-gov-west-1' });
    assert.strictEqual(saved.region, 'us-gov-west-1');
  });

  it('rejects malformed, URL-like, slash, and control-character regions', () => {
    assert.strictEqual(isValidAwsRegion('https://bedrock.us-east-1.amazonaws.com'), false);
    assert.strictEqual(isValidAwsRegion('us-east-1/test'), false);
    assert.strictEqual(isValidAwsRegion('us-east-1\\test'), false);
    assert.strictEqual(isValidAwsRegion('us-east-1\n'), false);
    assert.strictEqual(isValidAwsRegion('  us-east-1  '), false);
    assert.strictEqual(isValidAwsRegion('-us-east-1'), false);
    assert.strictEqual(isValidAwsRegion('us-east-1-'), false);

    assert.throws(() => {
      configService.saveConfig({ region: 'https://bedrock.us-east-1.amazonaws.com' });
    }, /Invalid AWS Region format/);

    assert.throws(() => {
      configService.saveConfig({ region: 'us-east-1/test' });
    }, /Invalid AWS Region format/);
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

  it('does not silently select an unrelated profile region from ~/.aws/config', () => {
    const origHomedir = os.homedir;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-aws-cfg-test-'));
    const awsDir = path.join(fakeHome, '.aws');
    fs.mkdirSync(awsDir, { recursive: true });

    fs.writeFileSync(
      path.join(awsDir, 'config'),
      `
[profile company-prod]
region = eu-west-1

[profile my-dev]
region = ap-southeast-1
`,
      'utf-8'
    );

    (os as any).homedir = () => fakeHome;
    try {
      // If asking for default profile: neither company-prod nor my-dev should be returned
      const defaultReg = configService.detectDefaultRegion('default');
      assert.strictEqual(defaultReg, undefined);

      // If asking for my-dev profile: should get ap-southeast-1
      const devReg = configService.detectDefaultRegion('my-dev');
      assert.strictEqual(devReg, 'ap-southeast-1');
    } finally {
      (os as any).homedir = origHomedir;
      try {
        fs.rmSync(fakeHome, { recursive: true, force: true });
      } catch {}
    }
  });

  it('resolves AWS_PROFILE-selected profile region and respects priority and custom AWS_CONFIG_FILE', () => {
    const origEnv = { ...process.env };
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-aws-env-test-'));
    const customConfigFile = path.join(fakeDir, 'custom-aws-config');

    fs.writeFileSync(
      customConfigFile,
      `
[default]
region = us-east-1

[profile bedrock-main]
region = ap-south-1

[profile work-profile]
region = eu-central-1
`,
      'utf-8'
    );

    try {
      delete process.env.AWS_REGION;
      delete process.env.AWS_DEFAULT_REGION;
      delete process.env.AWS_PROFILE;
      process.env.AWS_CONFIG_FILE = customConfigFile;

      // 1. Custom AWS_CONFIG_FILE is respected
      assert.strictEqual(configService.getAwsConfigFilePath(), customConfigFile);

      // 2. When no env vars or explicit profile: default profile region
      assert.strictEqual(configService.detectDefaultRegion(), 'us-east-1');

      // 3. AWS_PROFILE selects that profile's region
      process.env.AWS_PROFILE = 'bedrock-main';
      assert.strictEqual(configService.detectDefaultRegion(), 'ap-south-1');

      // 4. If AWS_PROFILE points to an unconfigured profile, does NOT fall back to default profile
      process.env.AWS_PROFILE = 'unknown-profile';
      assert.strictEqual(configService.detectDefaultRegion(), undefined);

      // 5. Explicit Minfy profile overrides AWS_PROFILE
      process.env.AWS_PROFILE = 'bedrock-main';
      assert.strictEqual(configService.detectDefaultRegion('work-profile'), 'eu-central-1');

      // 6. AWS_DEFAULT_REGION has higher priority than AWS_PROFILE
      process.env.AWS_DEFAULT_REGION = 'sa-east-1';
      assert.strictEqual(configService.detectDefaultRegion(), 'sa-east-1');

      // 7. AWS_REGION has highest priority
      process.env.AWS_REGION = 'ca-central-1';
      assert.strictEqual(configService.detectDefaultRegion(), 'ca-central-1');
    } finally {
      process.env = origEnv;
      try {
        fs.rmSync(fakeDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
