import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { ProviderFactory } from '../src/services/ai/providerFactory.js';
import { ProviderManifest } from '@minfy/shared';

describe('Dynamic Registry & End-to-End Compatible Provider (Milestone 5)', () => {
  let fakeServer: http.Server;
  let serverPort: number;

  before(async () => {
    fakeServer = http.createServer((req, res) => {
      if (req.url === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            data: [
              { id: 'custom-model-fast', name: 'Custom Model Fast', context_length: 4096 },
              { id: 'custom-model-code', name: 'Custom Model Code', context_length: 8192 },
            ],
          })
        );
      }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        // Send streaming SSE chunks
        res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
        setTimeout(() => {
          res.write('data: {"choices":[{"delta":{"content":" world!"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }, 50);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      fakeServer.listen(0, '127.0.0.1', () => {
        const addr = fakeServer.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      fakeServer.close(() => resolve());
    });
  });

  it('protects built-in providers from deletion', () => {
    assert.throws(() => {
      aiProviderRegistry.unregisterAdapter('ollama');
    }, /Built-in provider "ollama" cannot be removed/);

    assert.throws(() => {
      aiProviderRegistry.unregisterAdapter('openrouter');
    }, /Built-in provider "openrouter" cannot be removed/);
  });

  it('dynamically registers and unregisters a custom provider', () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'dynamic-dummy',
      name: 'Dynamic Dummy',
      protocol: 'openai-compatible',
      providerType: 'local',
      baseUrl: 'http://127.0.0.1:9999/v1',
      auth: { type: 'none' },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);

    assert.ok(aiProviderRegistry.getAdapter('dynamic-dummy'));

    const removed = aiProviderRegistry.unregisterAdapter('dynamic-dummy');
    assert.strictEqual(removed, true);
    assert.strictEqual(aiProviderRegistry.getAdapter('dynamic-dummy'), undefined);
  });

  it('executes full end-to-end model discovery and streaming generation', async () => {
    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'fake-openai-server',
      name: 'Fake Local Server',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      auth: { type: 'none' },
      defaults: {
        executionLocation: 'local',
        billingType: 'free',
      },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);

    // 1. Verify listModels
    const models = await aiProviderRegistry.listModels('fake-openai-server');
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models[0].id, 'custom-model-fast');
    assert.strictEqual(models[0].providerId, 'fake-openai-server');
    assert.strictEqual(models[0].executionLocation, 'local');
    assert.strictEqual(models[0].billingType, 'free');

    // 2. Verify streaming generation
    const deltas: string[] = [];
    const usage = await aiProviderRegistry.generate(
      'gen-test-e2e-1',
      {
        providerId: 'fake-openai-server',
        modelId: 'custom-model-fast',
        prompt: 'Say hello',
      },
      (event) => {
        if (event.type === 'text-delta' && event.textDelta) {
          deltas.push(event.textDelta);
        }
      }
    );

    assert.strictEqual(deltas.join(''), 'Hello world!');
    assert.strictEqual(usage.status, 'completed');
    assert.strictEqual(usage.providerId, 'fake-openai-server');
    assert.strictEqual(usage.modelId, 'custom-model-fast');
    assert.strictEqual(usage.executionLocation, 'local');
    assert.strictEqual(usage.billingType, 'free');

    // Cleanup
    aiProviderRegistry.unregisterAdapter('fake-openai-server');
  });

  it('supports cancellation during generation', async () => {
    // Create a slow endpoint on the server
    const slowServer = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"Chunk 1"}}]}\n\n');
      // Intentionally do not end immediately
    });

    const slowPort = await new Promise<number>((resolve) => {
      slowServer.listen(0, '127.0.0.1', () => {
        resolve((slowServer.address() as any).port);
      });
    });

    const manifest: ProviderManifest = {
      schemaVersion: 1,
      id: 'slow-server',
      name: 'Slow Server',
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: `http://127.0.0.1:${slowPort}/v1`,
      auth: { type: 'none' },
      source: 'custom',
    };

    const adapter = ProviderFactory.createProviderFromManifest(manifest);
    aiProviderRegistry.registerAdapter(adapter);

    const genPromise = aiProviderRegistry.generate(
      'gen-cancel-test',
      {
        providerId: 'slow-server',
        modelId: 'default',
        prompt: 'test',
      },
      () => {}
    );

    // Cancel shortly after start
    setTimeout(() => {
      aiProviderRegistry.cancel('gen-cancel-test');
    }, 50);

    const usage = await genPromise;
    assert.strictEqual(usage.status, 'cancelled');

    // Cleanup
    aiProviderRegistry.unregisterAdapter('slow-server');
    await new Promise<void>((r) => slowServer.close(() => r()));
  });
});
