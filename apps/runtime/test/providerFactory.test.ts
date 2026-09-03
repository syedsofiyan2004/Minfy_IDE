import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ProviderFactory } from '../src/services/ai/providerFactory.js';
import { credentialStore } from '../src/services/credentialStore.js';
import { ProviderManifest } from '@minfy/shared';

describe('Provider Factory Architecture (Milestone 5)', () => {
  it('creates an OpenAICompatibleAdapter from a valid manifest', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'custom-ai',
      name: 'Custom AI',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://api.custom.example/v1',
      auth: { type: 'none' },
      defaults: {
        executionLocation: 'cloud',
        billingType: 'metered',
      },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    assert.ok(adapter);
    assert.strictEqual(adapter.id, 'custom-ai');
    assert.strictEqual(adapter.name, 'Custom AI');
    assert.strictEqual(adapter.type, 'api');
    assert.strictEqual(adapter.source, 'custom');
    assert.strictEqual(adapter.protocol, 'openai-compatible');
    assert.strictEqual((adapter as any).requiresAuth, false);
  });

  it('maps bearer auth to CredentialStore lookup', async () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'bearer-ai',
      name: 'Bearer AI',
      protocol: 'openai-compatible',
      providerType: 'enterprise',
      baseUrl: 'https://enterprise.example/v1',
      auth: { type: 'bearer', required: true },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    assert.strictEqual((adapter as any).requiresAuth, true);

    // Populate credential in credentialStore
    await credentialStore.set('bearer-ai', 'test-token-xyz');

    // Retrieve headers via protected method
    const headers = await (adapter as any).getHeaders();
    assert.strictEqual(headers['Authorization'], 'Bearer test-token-xyz');

    // Cleanup
    await credentialStore.delete('bearer-ai');
  });

  it('preserves default execution and billing semantics without guessing', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'unspecified-ai',
      name: 'Unspecified AI',
      protocol: 'openai-compatible',
      providerType: 'local',
      baseUrl: 'http://127.0.0.1:8000/v1',
      auth: { type: 'none' },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    // Even though providerType is 'local' and baseUrl is localhost, default semantics must remain 'unknown' unless specified
    assert.strictEqual((adapter as any).config.defaultExecutionLocation, 'unknown');
    assert.strictEqual((adapter as any).config.defaultBillingType, 'unknown');
  });

  it('rejects unsupported manifest protocols', () => {
    const manifest: any = {
      schemaVersion: 1,
      id: 'bedrock-ai',
      name: 'Bedrock AI',
      protocol: 'bedrock',
      providerType: 'cloud',
      baseUrl: 'https://bedrock.aws',
      auth: { type: 'none' },
    };

    assert.throws(() => {
      ProviderFactory.createProviderFromManifest(manifest);
    }, /Unsupported manifest protocol/);
  });
});
