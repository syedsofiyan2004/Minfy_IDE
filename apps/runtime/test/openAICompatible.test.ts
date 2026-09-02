import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { OpenAICompatibleAdapter } from '../src/services/ai/adapters/openAICompatibleAdapter.js';
import {
  OpenRouterAdapter,
  classifyOpenRouterModel,
  getOpenRouterHeaders,
} from '../src/services/ai/adapters/openRouterAdapter.js';
import { AIProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { AIStreamEvent } from '@minfy/shared';

describe('OpenAI-Compatible Generic Provider Adapter', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let lastAuthHeader: string | undefined;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      lastAuthHeader = req.headers['authorization'];

      // Handle GET /models
      if (req.method === 'GET' && req.url === '/models') {
        if (req.headers['authorization'] === 'Bearer invalid-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: 'meta-llama/llama-3-8b-instruct:free', name: 'Llama 3 8B (Free)', context_length: 8192 },
              { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000 },
            ],
          })
        );
        return;
      }

      // Handle POST /chat/completions
      if (req.method === 'POST' && req.url === '/chat/completions') {
        if (req.headers['authorization'] === 'Bearer invalid-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        res.write(`data: ${JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ delta: { content: 'Hello' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ delta: { content: ' from' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ delta: { content: ' OpenAI-compatible' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ delta: { content: ' provider!' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', usage: { prompt_tokens: 12, completion_tokens: 6 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as any;
        mockPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => mockServer.close(resolve));
  });

  test('applies Authorization header and queries model list', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'mock-compat',
      name: 'Mock Compatible Provider',
      type: 'api',
      baseUrl: `http://127.0.0.1:${mockPort}`,
      requiresAuth: true,
      getApiKey: () => 'valid-mock-key',
    });

    const status = await adapter.getStatus();
    assert.strictEqual(status.status, 'available');
    assert.strictEqual(status.modelsCount, 2);
    assert.strictEqual(lastAuthHeader, 'Bearer valid-mock-key');

    const models = await adapter.listModels();
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models[0].id, 'meta-llama/llama-3-8b-instruct:free');
    assert.strictEqual(models[1].id, 'openai/gpt-4o');
  });

  test('normalizes 401 unauthorized response into clean user error', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'mock-compat-auth-err',
      name: 'Mock Provider',
      type: 'api',
      baseUrl: `http://127.0.0.1:${mockPort}`,
      requiresAuth: true,
      getApiKey: () => 'invalid-key',
    });

    const status = await adapter.getStatus();
    assert.strictEqual(status.status, 'unavailable');
    assert.ok(status.reason?.includes('Authentication failed'));
  });

  test('normalizes streamed SSE chunks, captures resolvedModelId, and handles [DONE] termination', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'mock-compat-stream',
      name: 'Mock Stream Provider',
      type: 'api',
      baseUrl: `http://127.0.0.1:${mockPort}`,
      requiresAuth: true,
      getApiKey: () => 'valid-mock-key',
      defaultExecutionLocation: 'cloud',
      defaultBillingType: 'unknown',
    });

    const events: AIStreamEvent[] = [];
    const usage = await adapter.generate(
      {
        providerId: 'mock-compat-stream',
        modelId: 'openrouter/free',
        prompt: 'Say hello',
      },
      (event) => {
        events.push(event);
      }
    );

    assert.strictEqual(usage.status, 'completed');
    assert.strictEqual(usage.executionLocation, 'cloud');
    assert.strictEqual(usage.modelId, 'openrouter/free');
    assert.strictEqual(usage.resolvedModelId, 'meta-llama/llama-3.3-70b-instruct:free');
    assert.strictEqual(usage.inputTokenCount, 12);
    assert.strictEqual(usage.outputTokenCount, 6);

    const deltas = events.filter((e) => e.type === 'text-delta').map((e) => e.textDelta).join('');
    assert.strictEqual(deltas, 'Hello from OpenAI-compatible provider!');
  });
});

describe('OpenRouter Header Attribution & Model Semantics (Milestone 4.1)', () => {
  test('omits HTTP-Referer when MINFY_APP_URL is not configured', () => {
    const origUrl = process.env.MINFY_APP_URL;
    delete process.env.MINFY_APP_URL;

    const headers = getOpenRouterHeaders();
    assert.strictEqual(headers['X-Title'], 'Minfy IDE');
    assert.strictEqual(headers['HTTP-Referer'], undefined);

    process.env.MINFY_APP_URL = origUrl;
  });

  test('includes HTTP-Referer when MINFY_APP_URL is explicitly configured', () => {
    const origUrl = process.env.MINFY_APP_URL;
    process.env.MINFY_APP_URL = 'https://my-ide.internal';

    const headers = getOpenRouterHeaders();
    assert.strictEqual(headers['X-Title'], 'Minfy IDE');
    assert.strictEqual(headers['HTTP-Referer'], 'https://my-ide.internal');

    process.env.MINFY_APP_URL = origUrl;
  });

  test('classifies openrouter/free and :free models as cloud execution with free billing', () => {
    const free1 = classifyOpenRouterModel('openrouter/free');
    assert.strictEqual(free1.executionLocation, 'cloud');
    assert.strictEqual(free1.billingType, 'free');
    assert.ok(free1.costDescription.includes('Free token pricing'));
    assert.ok(free1.costDescription.includes('Remote inference'));

    const free2 = classifyOpenRouterModel('meta-llama/llama-3-8b-instruct:free');
    assert.strictEqual(free2.executionLocation, 'cloud');
    assert.strictEqual(free2.billingType, 'free');
  });

  test('identifies free models using zero-token pricing metadata', () => {
    const zeroPriced = classifyOpenRouterModel('custom-free-model', {
      pricing: { prompt: '0', completion: '0' },
    });
    assert.strictEqual(zeroPriced.executionLocation, 'cloud');
    assert.strictEqual(zeroPriced.billingType, 'free');
  });

  test('classifies paid/standard OpenRouter models as cloud execution with unknown billing', () => {
    const paid1 = classifyOpenRouterModel('anthropic/claude-3.5-sonnet', {
      pricing: { prompt: '0.000003', completion: '0.000015' },
    });
    assert.strictEqual(paid1.executionLocation, 'cloud');
    assert.strictEqual(paid1.billingType, 'unknown');
    assert.ok(paid1.costDescription.includes('Provider quota applies'));

    const paid2 = classifyOpenRouterModel('openai/gpt-4o');
    assert.strictEqual(paid2.executionLocation, 'cloud');
    assert.strictEqual(paid2.billingType, 'unknown');
  });
});

describe('Multi-Provider Coexistence in Registry', () => {
  test('Ollama and OpenRouter coexist independently in AIProviderRegistry', async () => {
    const registry = new AIProviderRegistry();
    const providers = await registry.listProviders();

    assert.ok(providers.some((p) => p.id === 'ollama'), 'Ollama should be registered');
    assert.ok(providers.some((p) => p.id === 'openrouter'), 'OpenRouter should be registered');

    const openrouter = providers.find((p) => p.id === 'openrouter');
    assert.strictEqual(openrouter?.type, 'router');
    assert.strictEqual(openrouter?.requiresAuth, true);
  });
});
