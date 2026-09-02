import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AIProviderAdapter } from '../src/services/ai/types.js';
import { AIProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { OllamaAdapter } from '../src/services/ai/adapters/ollamaAdapter.js';
import { AIGenerateRequest, AIStreamEvent, AIUsage } from '@minfy/shared';

class FakeAIAdapter implements AIProviderAdapter {
  public readonly id = 'fake-provider';
  public readonly name = 'Fake Provider';
  public readonly type = 'local' as const;

  public async getStatus() {
    return { status: 'available' as const, modelsCount: 2 };
  }

  public async listModels() {
    return [
      { id: 'fake-model-1', providerId: 'fake-provider', displayName: 'Fake Model 1', supportsStreaming: true },
      { id: 'fake-model-2', providerId: 'fake-provider', displayName: 'Fake Model 2', supportsStreaming: true },
    ];
  }

  public async generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    onStream({ type: 'started' });

    const words = ['Hello', 'from', 'Minfy', 'IDE', 'AI!'];
    for (const word of words) {
      if (abortSignal?.aborted) {
        const usage: AIUsage = {
          providerId: this.id,
          modelId: request.modelId,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          status: 'cancelled',
          costDescription: 'Test provider',
        };
        onStream({ type: 'error', error: 'Generation stopped by user', usage });
        return usage;
      }

      onStream({ type: 'text-delta', textDelta: word + ' ' });
      await new Promise((r) => setTimeout(r, 20));
    }

    const usage: AIUsage = {
      providerId: this.id,
      modelId: request.modelId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      inputTokenCount: 10,
      outputTokenCount: 5,
      status: 'completed',
      costDescription: 'Test provider • No API charge',
    };

    onStream({ type: 'usage', usage });
    onStream({ type: 'completed', usage });
    return usage;
  }
}

describe('AI Provider Foundation & Registry', () => {
  test('registers provider and lists available providers', async () => {
    const registry = new AIProviderRegistry();
    const fake = new FakeAIAdapter();
    registry.registerAdapter(fake);

    const providers = await registry.listProviders();
    assert.ok(providers.length >= 2, 'Should list Ollama and Fake provider');

    const fakeProvider = providers.find((p) => p.id === 'fake-provider');
    assert.ok(fakeProvider, 'Fake provider should be listed');
    assert.strictEqual(fakeProvider.status, 'available');
    assert.strictEqual(fakeProvider.modelsCount, 2);
  });

  test('lists models for registered provider', async () => {
    const registry = new AIProviderRegistry();
    registry.registerAdapter(new FakeAIAdapter());

    const models = await registry.listModels('fake-provider');
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models[0].id, 'fake-model-1');
  });

  test('handles unknown provider gracefully when listing models', async () => {
    const registry = new AIProviderRegistry();
    await assert.rejects(async () => {
      await registry.listModels('non-existent-provider');
    }, /Provider not found/);
  });

  test('streams generation events and records usage metadata', async () => {
    const registry = new AIProviderRegistry();
    registry.registerAdapter(new FakeAIAdapter());

    const events: AIStreamEvent[] = [];
    const usage = await registry.generate(
      'gen-test-1',
      {
        providerId: 'fake-provider',
        modelId: 'fake-model-1',
        prompt: 'Say hello',
      },
      (event) => {
        events.push(event);
      }
    );

    assert.strictEqual(usage.status, 'completed');
    assert.strictEqual(usage.inputTokenCount, 10);
    assert.strictEqual(usage.outputTokenCount, 5);

    // Verify stream event sequence
    assert.strictEqual(events[0].type, 'started');
    const textDeltas = events.filter((e) => e.type === 'text-delta');
    assert.strictEqual(textDeltas.length, 5);
    const fullText = textDeltas.map((e) => e.textDelta).join('');
    assert.strictEqual(fullText, 'Hello from Minfy IDE AI! ');

    const completedEvent = events.find((e) => e.type === 'completed');
    assert.ok(completedEvent);
  });

  test('cancels active generation and returns cancelled status', async () => {
    const registry = new AIProviderRegistry();
    registry.registerAdapter(new FakeAIAdapter());

    const events: AIStreamEvent[] = [];
    const genPromise = registry.generate(
      'gen-cancel-test',
      {
        providerId: 'fake-provider',
        modelId: 'fake-model-1',
        prompt: 'Say hello',
      },
      (event) => {
        events.push(event);
      }
    );

    // Cancel after 30ms (during streaming)
    await new Promise((r) => setTimeout(r, 30));
    const wasCancelled = registry.cancel('gen-cancel-test');
    assert.strictEqual(wasCancelled, true);

    const usage = await genPromise;
    assert.strictEqual(usage.status, 'cancelled');

    const errEvent = events.find((e) => e.type === 'error');
    assert.ok(errEvent);
    assert.ok(errEvent.error?.includes('stopped by user'));
  });
});

describe('Ollama Adapter Offline & Health Handling', () => {
  test('returns unavailable status when Ollama port is unreachable without crashing', async () => {
    // Point to non-existent port to test offline handling
    const adapter = new OllamaAdapter('http://127.0.0.1:59999');
    const statusResult = await adapter.getStatus();

    assert.strictEqual(statusResult.status, 'unavailable');
    assert.ok(statusResult.reason?.includes('Ollama is not running'));
  });

  test('returns empty model list when Ollama is offline without throwing', async () => {
    const adapter = new OllamaAdapter('http://127.0.0.1:59999');
    const models = await adapter.listModels();
    assert.deepStrictEqual(models, []);
  });
});
