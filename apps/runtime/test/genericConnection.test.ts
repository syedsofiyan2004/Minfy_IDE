import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { OpenAICompatibleAdapter } from '../src/services/ai/adapters/openAICompatibleAdapter.js';
import { credentialStore } from '../src/services/credentialStore.js';

describe('Generic Credential Validation & Connection Safety (Milestone 5)', () => {
  let server: http.Server;
  let serverPort: number;

  before(async () => {
    server = http.createServer((req, res) => {
      const auth = req.headers['authorization'];

      if (req.url === '/v1/models') {
        if (auth === 'Bearer valid-secret-key') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ data: [{ id: 'model-a' }] }));
        }
        if (auth === 'Bearer forbidden-key') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('validates and accepts a correct Bearer credential', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'test-endpoint',
      name: 'Test Endpoint',
      type: 'api',
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      requiresAuth: true,
    });

    const result = await adapter.validateCredential('valid-secret-key');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, undefined);
  });

  it('rejects an invalid credential (HTTP 401)', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'test-endpoint',
      name: 'Test Endpoint',
      type: 'api',
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      requiresAuth: true,
    });

    const result = await adapter.validateCredential('invalid-key-xyz');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason || '', /Authentication failed/);
  });

  it('rejects a forbidden credential (HTTP 403)', async () => {
    const adapter = new OpenAICompatibleAdapter({
      id: 'test-endpoint',
      name: 'Test Endpoint',
      type: 'api',
      baseUrl: `http://127.0.0.1:${serverPort}/v1`,
      requiresAuth: true,
    });

    const result = await adapter.validateCredential('forbidden-key');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason || '', /Authentication failed/);
  });

  it('does NOT silently persist credential when provider is unreachable', async () => {
    const unreachableAdapter = new OpenAICompatibleAdapter({
      id: 'unreachable-endpoint',
      name: 'Unreachable Endpoint',
      type: 'api',
      baseUrl: 'http://127.0.0.1:54321/v1', // Non-listening port
      requiresAuth: true,
    });

    const result = await unreachableAdapter.validateCredential('any-key');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason || '', /could not be reached/);

    // Ensure it was never saved
    const stored = credentialStore.getCredential('unreachable-endpoint');
    assert.strictEqual(stored, undefined);
  });

  it('deleting connection clears stored credential', async () => {
    await credentialStore.set('disconnect-test', 'my-token');
    assert.strictEqual(credentialStore.hasCredential('disconnect-test'), true);

    await credentialStore.delete('disconnect-test');
    assert.strictEqual(credentialStore.hasCredential('disconnect-test'), false);
  });

  it('generic AI routes do NOT contain provider-specific openrouter branch for validation', () => {
    const routesPath = path.resolve(import.meta.dirname, '../src/routes/aiRoutes.ts');
    const content = fs.readFileSync(routesPath, 'utf-8');

    // Verify there is no 'providerId === "openrouter"' or 'providerId === \'openrouter\''
    assert.doesNotMatch(
      content,
      /providerId\s*===\s*['"]openrouter['"]/,
      'aiRoutes.ts must not contain provider-specific checks for openrouter'
    );
  });
});
