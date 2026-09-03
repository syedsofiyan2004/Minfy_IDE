import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ProviderManifestService,
  RESERVED_PROVIDER_IDS,
} from '../src/services/ai/providerManifestService.js';

describe('Provider Manifest Validation & Storage (Milestone 5)', () => {
  let testDir: string;
  let service: ProviderManifestService;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-manifest-test-'));
    service = new ProviderManifestService(testDir);
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('accepts a valid schema v1 manifest', () => {
    const raw = {
      schemaVersion: 1,
      id: 'company-ai',
      name: 'Company AI Gateway',
      protocol: 'openai-compatible',
      providerType: 'enterprise',
      baseUrl: 'https://ai.company.example/v1',
      auth: { type: 'bearer', required: true },
      defaults: {
        executionLocation: 'cloud',
        billingType: 'subscription',
      },
    };

    const res = service.validateManifest(raw);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.manifest?.id, 'company-ai');
    assert.strictEqual(res.manifest?.source, 'custom');
    assert.strictEqual(res.manifest?.defaults?.executionLocation, 'cloud');
  });

  it('rejects unsupported schema version', () => {
    const raw = {
      schemaVersion: 2,
      id: 'future-ai',
      name: 'Future AI',
      protocol: 'openai-compatible',
      baseUrl: 'https://ai.example.com',
      auth: { type: 'none' },
    };

    const res = service.validateManifest(raw);
    assert.strictEqual(res.valid, false);
    assert.match(res.error || '', /Unsupported provider manifest schema version/);
  });

  it('rejects invalid provider IDs', () => {
    const invalidIds = [
      '',
      '   ',
      'Company AI', // spaces
      '-starts-with-dash',
      'has/slash',
      'has\\backslash',
      '../traversal',
      'UPPERCASE',
    ];

    for (const badId of invalidIds) {
      const res = service.validateManifest({
        schemaVersion: 1,
        id: badId,
        name: 'Test',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        auth: { type: 'none' },
      });
      assert.strictEqual(res.valid, false, `Expected ID "${badId}" to be rejected`);
    }
  });

  it('rejects collision with reserved built-in provider IDs', () => {
    for (const reserved of RESERVED_PROVIDER_IDS) {
      const res = service.validateManifest({
        schemaVersion: 1,
        id: reserved,
        name: 'Impostor',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        auth: { type: 'none' },
      });
      assert.strictEqual(res.valid, false);
      assert.match(res.error || '', /reserved for built-in providers/);
    }
  });

  it('rejects malformed or non-http Base URLs', () => {
    const badUrls = [
      'not-a-url',
      'ftp://ftp.example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/plain,hello',
    ];

    for (const url of badUrls) {
      const res = service.validateManifest({
        schemaVersion: 1,
        id: 'bad-url-ai',
        name: 'Bad URL',
        protocol: 'openai-compatible',
        baseUrl: url,
        auth: { type: 'none' },
      });
      assert.strictEqual(res.valid, false, `Expected URL "${url}" to be rejected`);
    }
  });

  it('rejects Base URLs with embedded credentials', () => {
    const res = service.validateManifest({
      schemaVersion: 1,
      id: 'auth-url-ai',
      name: 'Auth URL',
      protocol: 'openai-compatible',
      baseUrl: 'https://user:password@ai.example.com/v1',
      auth: { type: 'none' },
    });
    assert.strictEqual(res.valid, false);
    assert.match(res.error || '', /embedded username or password/);
  });

  it('rejects cloud link-local metadata endpoints', () => {
    const metadataUrls = [
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1',
    ];

    for (const url of metadataUrls) {
      const res = service.validateManifest({
        schemaVersion: 1,
        id: 'metadata-target',
        name: 'Metadata Target',
        protocol: 'openai-compatible',
        baseUrl: url,
        auth: { type: 'none' },
      });
      assert.strictEqual(res.valid, false, `Expected metadata URL "${url}" to be rejected`);
      assert.match(res.error || '', /reserved link-local metadata/);
    }
  });

  it('rejects manifests containing secret / API key fields', () => {
    const secretKeys = ['apiKey', 'api_key', 'token', 'secret', 'password'];

    for (const secKey of secretKeys) {
      const raw: any = {
        schemaVersion: 1,
        id: 'secret-ai',
        name: 'Secret AI',
        protocol: 'openai-compatible',
        baseUrl: 'https://ai.example.com/v1',
        auth: { type: 'bearer' },
      };
      raw[secKey] = 'sk-secret-123';

      const res = service.validateManifest(raw);
      assert.strictEqual(res.valid, false, `Expected manifest with field "${secKey}" to be rejected`);
      assert.match(res.error || '', /must not contain secret fields/);
    }
  });

  it('rejects forbidden custom headers (Authorization, Host, Cookie, etc.)', () => {
    const forbidden = ['Authorization', 'Host', 'Cookie', 'Content-Length'];

    for (const header of forbidden) {
      const res = service.validateManifest({
        schemaVersion: 1,
        id: 'forbidden-header-ai',
        name: 'Header AI',
        protocol: 'openai-compatible',
        baseUrl: 'https://ai.example.com/v1',
        auth: { type: 'bearer' },
        customHeaders: {
          [header]: 'malicious-value',
        },
      });
      assert.strictEqual(res.valid, false, `Expected header "${header}" to be rejected`);
      assert.match(res.error || '', /forbidden/);
    }
  });

  it('persists manifest atomically and reloads it', () => {
    const manifest = {
      schemaVersion: 1 as const,
      id: 'local-test-ai',
      name: 'Local Test AI',
      protocol: 'openai-compatible' as const,
      providerType: 'local' as const,
      baseUrl: 'http://127.0.0.1:1234/v1',
      auth: { type: 'none' as const },
      defaults: {
        executionLocation: 'unknown' as const,
        billingType: 'unknown' as const,
      },
      source: 'custom' as const,
    };

    service.saveManifest(manifest);

    const loaded = service.getManifest('local-test-ai');
    assert.ok(loaded);
    assert.strictEqual(loaded.id, 'local-test-ai');
    assert.strictEqual(loaded.name, 'Local Test AI');
    assert.strictEqual(loaded.baseUrl, 'http://127.0.0.1:1234/v1');

    const list = service.listManifests();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'local-test-ai');
  });

  it('handles invalid / corrupt manifest file without crashing listManifests', () => {
    // Place a malformed JSON file into providersDir
    fs.writeFileSync(path.join(testDir, 'broken.json'), '{ "corrupt": invalid json }', 'utf-8');

    // listManifests must not throw; it should simply skip the corrupt file
    const list = service.listManifests();
    assert.ok(Array.isArray(list));
    // The valid manifest from previous test should still be loaded
    assert.ok(list.some((m) => m.id === 'local-test-ai'));
  });

  it('deletes manifest cleanly', () => {
    const deleted = service.deleteManifest('local-test-ai');
    assert.strictEqual(deleted, true);

    const check = service.getManifest('local-test-ai');
    assert.strictEqual(check, null);

    const deletedAgain = service.deleteManifest('local-test-ai');
    assert.strictEqual(deletedAgain, false);
  });
});
