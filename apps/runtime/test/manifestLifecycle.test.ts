import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderManifest } from '@minfy/shared';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { ProviderFactory } from '../src/services/ai/providerFactory.js';
import { ProviderManifestService } from '../src/services/ai/providerManifestService.js';
import { credentialStore } from '../src/services/credentialStore.js';

describe('Provider Manifest Lifecycle & Enabled Semantics (Milestone 5.1)', () => {
  let tempDir: string;
  let customService: ProviderManifestService;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minfy-lifecycle-test-'));
    customService = new ProviderManifestService(tempDir);
  });

  after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('enabled manifest registers normally', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'active-provider',
      name: 'Active Provider',
      protocol: 'openai-compatible',
      providerType: 'local',
      baseUrl: 'http://127.0.0.1:9000/v1',
      auth: { type: 'none' },
      enabled: true,
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);

    const retrieved = aiProviderRegistry.getAdapter('active-provider');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, 'Active Provider');

    // Cleanup
    aiProviderRegistry.unregisterAdapter('active-provider');
  });

  it('disabled manifest persists on disk but does NOT register adapter', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'disabled-provider',
      name: 'Disabled Provider',
      protocol: 'openai-compatible',
      providerType: 'local',
      baseUrl: 'http://127.0.0.1:9001/v1',
      auth: { type: 'none' },
      enabled: false,
      source: 'custom',
    };

    customService.saveManifest(manifest);

    // Verify it is on disk and in listManifests
    const loaded = customService.getManifest('disabled-provider');
    assert.ok(loaded);
    assert.strictEqual(loaded.enabled, false);

    const list = customService.listManifests();
    assert.ok(list.some((m) => m.id === 'disabled-provider'));

    // Verify adapter is NOT registered in AIProviderRegistry
    assert.strictEqual(aiProviderRegistry.getAdapter('disabled-provider'), undefined);
  });

  it('disabled manifest is absent from active provider selector/list', async () => {
    const providers = await aiProviderRegistry.listProviders();
    assert.strictEqual(providers.some((p) => p.id === 'disabled-provider'), false);
  });

  it('enabled -> disabled unregisters provider while keeping manifest & credential', async () => {
    // 1. Setup enabled provider with credential
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'toggle-ai',
      name: 'Toggle AI',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: 'https://api.toggle.example/v1',
      auth: { type: 'bearer', required: true },
      enabled: true,
      source: 'custom',
    };

    customService.saveManifest(manifest);
    await credentialStore.set('toggle-ai', 'secret-key-123');

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);
    assert.ok(aiProviderRegistry.getAdapter('toggle-ai'));

    // 2. Transition Enabled -> Disabled
    const updatedManifest: ProviderManifest = {
      ...manifest,
      enabled: false,
    };
    customService.saveManifest(updatedManifest);
    aiProviderRegistry.unregisterAdapter('toggle-ai');

    // Adapter is unregistered
    assert.strictEqual(aiProviderRegistry.getAdapter('toggle-ai'), undefined);

    // Manifest still exists on disk
    const saved = customService.getManifest('toggle-ai');
    assert.ok(saved);
    assert.strictEqual(saved.enabled, false);

    // Credential is NOT deleted on disable
    assert.strictEqual(credentialStore.getCredential('toggle-ai'), 'secret-key-123');

    // 3. Transition Disabled -> Enabled without restart
    const reEnabledManifest: ProviderManifest = {
      ...saved,
      enabled: true,
    };
    customService.saveManifest(reEnabledManifest);

    const reAdapter = ProviderFactory.createProviderFromManifest(reEnabledManifest);
    aiProviderRegistry.registerAdapter(reAdapter);

    assert.ok(aiProviderRegistry.getAdapter('toggle-ai'));

    // Cleanup
    aiProviderRegistry.unregisterAdapter('toggle-ai');
    customService.deleteManifest('toggle-ai');
    await credentialStore.delete('toggle-ai');
  });

  it('cannot unregister or modify provider while active generation is in progress', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'busy-provider',
      name: 'Busy Provider',
      protocol: 'openai-compatible',
      providerType: 'local',
      baseUrl: 'http://127.0.0.1:9002/v1',
      auth: { type: 'none' },
      enabled: true,
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);

    // Simulate active generation
    (aiProviderRegistry as any).activeGenerations.set('gen-test-busy', {
      providerId: 'busy-provider',
      modelId: 'test-model',
      startedAt: Date.now(),
      status: 'generating',
    });

    assert.strictEqual(aiProviderRegistry.hasActiveGeneration('busy-provider'), true);

    // Attempting to unregister must throw
    assert.throws(() => {
      aiProviderRegistry.unregisterAdapter('busy-provider');
    }, /Cannot remove.*while an active generation is in progress/);

    // Clear active generation and unregister cleanly
    (aiProviderRegistry as any).activeGenerations.delete('gen-test-busy');
    assert.strictEqual(aiProviderRegistry.unregisterAdapter('busy-provider'), true);
  });
});
