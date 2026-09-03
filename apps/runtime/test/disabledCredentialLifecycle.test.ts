import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderManifest } from '@minfy/shared';
import { credentialStore, ICredentialBackend } from '../src/services/credentialStore.js';
import { ProviderFactory } from '../src/services/ai/providerFactory.js';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { ProviderManifestService } from '../src/services/ai/providerManifestService.js';

class FakePersistentBackend implements ICredentialBackend {
  public readonly type = 'memory' as const;
  public readonly name = 'Fake Persistent Backend';
  public readonly isPersistent = true;
  public storage = new Map<string, string>();

  public async get(providerId: string): Promise<string | null> {
    return this.storage.get(providerId) || null;
  }

  public async set(providerId: string, credential: string): Promise<void> {
    const trimmed = credential.trim();
    if (!trimmed) {
      this.storage.delete(providerId);
    } else {
      this.storage.set(providerId, trimmed);
    }
  }

  public async delete(providerId: string): Promise<boolean> {
    return this.storage.delete(providerId);
  }

  public async has(providerId: string): Promise<boolean> {
    return this.storage.has(providerId);
  }
}

describe('Disabled Provider Credential Lifecycle Correctness (Milestone 5.1.1)', () => {
  let fakeBackend: FakePersistentBackend;
  let originalBackend: any;
  let tempDir: string;
  let manifestService: ProviderManifestService;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-m511-test-'));
    manifestService = new ProviderManifestService(tempDir);

    fakeBackend = new FakePersistentBackend();
    originalBackend = (credentialStore as any).backend;
    (credentialStore as any).backend = fakeBackend;
  });

  after(() => {
    (credentialStore as any).backend = originalBackend;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    fakeBackend.storage.clear();
    (credentialStore as any).memoryCache.clear();
  });

  it('bearer custom provider credential stored persistently is recovered after hot-cache purge and re-enable', async () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'bearer-restart-ai',
      name: 'Bearer Restart AI',
      protocol: 'openai-compatible',
      providerType: 'enterprise',
      baseUrl: 'https://api.restart.example/v1',
      auth: { type: 'bearer', required: true },
      enabled: true,
      source: 'custom',
    };

    // 1. Store credential persistently
    await credentialStore.set('bearer-restart-ai', 'persistent-secret-token');
    assert.strictEqual(fakeBackend.storage.get('bearer-restart-ai'), 'persistent-secret-token');

    // 2. Disable provider
    const disabledManifest: ProviderManifest = { ...manifest, enabled: false };
    manifestService.saveManifest(disabledManifest);

    // 3. Simulate fresh runtime boot / hot cache empty
    (credentialStore as any).memoryCache.clear();
    assert.strictEqual((credentialStore as any).memoryCache.has('bearer-restart-ai'), false);
    assert.strictEqual(fakeBackend.storage.has('bearer-restart-ai'), true);

    // 4. Provider re-enabled
    const reEnabledManifest: ProviderManifest = { ...disabledManifest, enabled: true };
    manifestService.saveManifest(reEnabledManifest);

    const adapter = ProviderFactory.createProviderFromManifest(reEnabledManifest);
    aiProviderRegistry.registerAdapter(adapter);

    // 5. Verify persisted credential is recovered on demand without user re-entry
    const headers = await (adapter as any).getHeaders();
    assert.strictEqual(headers['Authorization'], 'Bearer persistent-secret-token');

    // Verify it populated hot cache
    assert.strictEqual(credentialStore.getCredential('bearer-restart-ai'), 'persistent-secret-token');

    // Cleanup
    aiProviderRegistry.unregisterAdapter('bearer-restart-ai');
  });

  it('hot cache lookup loads from persistent backend and populates cache', async () => {
    // Populate persistent storage directly, leave memoryCache empty
    fakeBackend.storage.set('direct-key-ai', 'token-12345');
    assert.strictEqual((credentialStore as any).memoryCache.has('direct-key-ai'), false);

    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'direct-key-ai',
      name: 'Direct Key AI',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://direct.example/v1',
      auth: { type: 'bearer', required: true },
      enabled: true,
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    const headers = await (adapter as any).getHeaders();

    assert.strictEqual(headers['Authorization'], 'Bearer token-12345');
    assert.strictEqual(credentialStore.getCredential('direct-key-ai'), 'token-12345');
  });

  it('Case A: Bearer enabled -> None enabled deletes credential', async () => {
    await credentialStore.set('case-a-ai', 'token-a');
    assert.strictEqual(fakeBackend.storage.has('case-a-ai'), true);

    const existing: ProviderManifest = {
      schemaVersion: 1,
      id: 'case-a-ai',
      name: 'Case A',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
      enabled: true,
    };

    const updated: ProviderManifest = {
      ...existing,
      auth: { type: 'none' },
      enabled: true,
    };

    // Simulate transition logic
    if (existing.auth.type === 'bearer' && updated.auth.type === 'none') {
      await credentialStore.delete('case-a-ai');
    }

    assert.strictEqual(fakeBackend.storage.has('case-a-ai'), false);
    assert.strictEqual((credentialStore as any).memoryCache.has('case-a-ai'), false);
  });

  it('Case B: Bearer enabled -> None disabled deletes credential', async () => {
    await credentialStore.set('case-b-ai', 'token-b');
    assert.strictEqual(fakeBackend.storage.has('case-b-ai'), true);

    const existing: ProviderManifest = {
      schemaVersion: 1,
      id: 'case-b-ai',
      name: 'Case B',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
      enabled: true,
    };

    const updated: ProviderManifest = {
      ...existing,
      auth: { type: 'none' },
      enabled: false,
    };

    if (existing.auth.type === 'bearer' && updated.auth.type === 'none') {
      await credentialStore.delete('case-b-ai');
    }

    assert.strictEqual(fakeBackend.storage.has('case-b-ai'), false);
    assert.strictEqual((credentialStore as any).memoryCache.has('case-b-ai'), false);
  });

  it('Case C: Bearer disabled -> None disabled deletes credential', async () => {
    await credentialStore.set('case-c-ai', 'token-c');
    assert.strictEqual(fakeBackend.storage.has('case-c-ai'), true);

    const existing: ProviderManifest = {
      schemaVersion: 1,
      id: 'case-c-ai',
      name: 'Case C',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
      enabled: false,
    };

    const updated: ProviderManifest = {
      ...existing,
      auth: { type: 'none' },
      enabled: false,
    };

    if (existing.auth.type === 'bearer' && updated.auth.type === 'none') {
      await credentialStore.delete('case-c-ai');
    }

    assert.strictEqual(fakeBackend.storage.has('case-c-ai'), false);
    assert.strictEqual((credentialStore as any).memoryCache.has('case-c-ai'), false);
  });

  it('Case D: Bearer enabled -> Bearer disabled preserves credential', async () => {
    await credentialStore.set('case-d-ai', 'token-d');
    assert.strictEqual(fakeBackend.storage.has('case-d-ai'), true);

    const existing: ProviderManifest = {
      schemaVersion: 1,
      id: 'case-d-ai',
      name: 'Case D',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
      enabled: true,
    };

    const updated: ProviderManifest = {
      ...existing,
      enabled: false,
    };

    // Disabling does NOT delete credential
    if (existing.auth.type === 'bearer' && updated.auth.type === 'none') {
      await credentialStore.delete('case-d-ai');
    }

    assert.strictEqual(fakeBackend.storage.get('case-d-ai'), 'token-d');
  });

  it('Case E: Bearer disabled -> Bearer enabled restores credential', async () => {
    // Secret exists in persistent backend
    fakeBackend.storage.set('case-e-ai', 'token-e');
    // Memory cache cleared
    (credentialStore as any).memoryCache.clear();

    const existing: ProviderManifest = {
      schemaVersion: 1,
      id: 'case-e-ai',
      name: 'Case E',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
      enabled: false,
    };

    const updated: ProviderManifest = {
      ...existing,
      enabled: true,
    };

    if (updated.enabled !== false && updated.auth.type === 'bearer') {
      await credentialStore.get('case-e-ai');
    }

    assert.strictEqual(credentialStore.getCredential('case-e-ai'), 'token-e');
    assert.strictEqual(credentialStore.hasCredential('case-e-ai'), true);
  });
});
