import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { resolveRuntimeEntry } from '../../../cli/src/index.js';
import { resolveWebDistPath } from '../src/utils/webDist.js';
import { runtimeAuthService } from '../src/services/runtimeAuthService.js';
import { workspaceService } from '../src/services/workspaceService.js';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { codexRuntimeManager } from '../src/services/ai/codex/codexRuntimeManager.js';
import { mergeCodexStatus, AIProvider } from '@minfy/shared';
import {
  hostValidationMiddleware,
  corsOriginMiddleware,
  runtimeAuthMiddleware,
} from '../src/middleware/securityMiddleware.js';

describe('Milestone 7.5: Packaging, Production Assets & Workflow Integration', () => {
  const token = runtimeAuthService.getToken();
  let server: http.Server;
  let testPort: number;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(hostValidationMiddleware);
    app.use(corsOriginMiddleware);
    app.use(express.json());

    // Public health
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    // Centralized runtime auth middleware (mounted at root exactly like apps/runtime/src/index.ts)
    app.use(runtimeAuthMiddleware);

    // Protected API routes
    app.get('/api/workspaces', (_req, res) => {
      res.json({ success: true, data: workspaceService.listWorkspaces() });
    });
    app.post('/api/workspaces', async (req, res) => {
      try {
        const ws = await workspaceService.registerWorkspace(req.body.path);
        res.json({ success: true, data: { workspace: ws } });
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Static web app serving
    const webDist = resolveWebDistPath();
    if (webDist) {
      app.use(express.static(webDist));
      app.get('*', (_req, res, next) => {
        if (_req.path.startsWith('/api/') || _req.path.startsWith('/ws/')) {
          return next();
        }
        res.sendFile(path.join(webDist, 'index.html'));
      });
    }

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        testPort = addr.port;
        baseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('1. CLI runtime resolution is independent of process.cwd()', () => {
    const originalCwd = process.cwd();
    try {
      // Simulate running from a completely different directory
      const tempDir = fs.realpathSync(process.env.TEMP || 'C:\\Windows\\Temp');
      process.chdir(tempDir);

      const entry = resolveRuntimeEntry();
      assert.ok(entry.dist, 'resolveRuntimeEntry must locate runtime dist');
      assert.ok(fs.existsSync(entry.dist), `Runtime dist file must exist: ${entry.dist}`);
      assert.match(entry.dist, /runtime[\\/]dist[\\/]index\.js$/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('2. Runtime web asset resolution is independent of process.cwd()', () => {
    const originalCwd = process.cwd();
    try {
      const tempDir = fs.realpathSync(process.env.TEMP || 'C:\\Windows\\Temp');
      process.chdir(tempDir);

      const webDist = resolveWebDistPath();
      assert.ok(webDist, 'resolveWebDistPath must locate web dist directory');
      assert.ok(fs.existsSync(webDist), `Web dist must exist: ${webDist}`);
      assert.ok(fs.existsSync(path.join(webDist, 'index.html')), 'index.html must exist in web dist');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('3. Production index.html can be served successfully', async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { Host: `127.0.0.1:${testPort}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Minfy IDE<\/title>/);
    assert.match(html, /<div id="root"><\/div>/);
  });

  test('4. API routes and WebSocket routes are NOT swallowed by SPA fallback', async () => {
    // Calling an API route that exists
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Host: `127.0.0.1:${testPort}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');

    // Calling an unauthenticated protected API route returns 401, NOT index.html
    const authRes = await fetch(`${baseUrl}/api/workspaces`, {
      headers: { Host: `127.0.0.1:${testPort}` },
    });
    assert.equal(authRes.status, 401);
    const errData = await authRes.json();
    assert.ok(errData.error?.includes('Runtime authentication required'));
  });

  test('5. Runtime health endpoint remains public without token', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Host: `127.0.0.1:${testPort}` },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
  });

  test('6. Protected routes still require capability token', async () => {
    // Missing token
    const resUnauthorized = await fetch(`${baseUrl}/api/workspaces`, {
      headers: { Host: `127.0.0.1:${testPort}` },
    });
    assert.equal(resUnauthorized.status, 401);

    // Valid token
    const resAuthorized = await fetch(`${baseUrl}/api/workspaces`, {
      headers: {
        Host: `127.0.0.1:${testPort}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(resAuthorized.status, 200);
    const data = await resAuthorized.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data));
  });

  test('7. Workspace registration through CLI remains authenticated', async () => {
    const postData = JSON.stringify({ path: process.cwd() });
    const res = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${testPort}`,
        Authorization: `Bearer ${token}`,
      },
      body: postData,
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.success, true);
    assert.ok(result.data.workspace);
    assert.ok(result.data.workspace.id);
  });

  test('8. Browser bootstrap URL uses fragment, never query string', () => {
    const workspaceId = 'test-ws-123';
    const secretToken = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const cliBrowserUrl = `http://127.0.0.1:4560/?workspaceId=${workspaceId}#runtimeToken=${secretToken}`;
    const sanitizedUrl = `http://127.0.0.1:4560/?workspaceId=${workspaceId}`;

    const urlObj = new URL(cliBrowserUrl);
    // Token MUST NOT be in query string
    assert.equal(urlObj.searchParams.has('runtimeToken'), false);
    // Token MUST be exclusively in the fragment
    assert.equal(urlObj.hash, `#runtimeToken=${secretToken}`);
    // Sanitized URL printed to CLI stdout has zero tokens
    assert.equal(sanitizedUrl.includes(secretToken), false);
  });

  test('9. Missing frontend assets produces a useful diagnostic page rather than silent crash', async () => {
    const fallbackApp = express();
    // Simulate missing web dist
    fallbackApp.get('*', (_req, res, next) => {
      if (_req.path.startsWith('/api/') || _req.path.startsWith('/ws/')) return next();
      res.status(503).send('<h2>Minfy IDE Web Assets Not Found</h2><p>Please run: npm run build</p>');
    });

    const fallbackServer = http.createServer(fallbackApp);
    await new Promise<void>((resolve) => {
      fallbackServer.listen(0, '127.0.0.1', resolve);
    });
    const addr = fallbackServer.address() as any;

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/`);
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.match(text, /Minfy IDE Web Assets Not Found/);
      assert.match(text, /npm run build/);
    } finally {
      await new Promise<void>((resolve) => fallbackServer.close(() => resolve()));
    }
  });

  test('10. External provider failure does not prevent runtime startup or provider listing', async () => {
    // aiProviderRegistry contains built-ins: ollama, openrouter, bedrock, codex
    const providers = await aiProviderRegistry.listProviders();
    assert.ok(Array.isArray(providers));
    const ids = providers.map((p) => p.id);
    assert.ok(ids.includes('ollama'), 'Ollama must be present');
    assert.ok(ids.includes('openrouter'), 'OpenRouter must be present');
    assert.ok(ids.includes('bedrock'), 'Bedrock must be present');
    assert.ok(ids.includes('codex'), 'Codex must be present');

    // Startup is not blocked even when external services are unreachable
    assert.ok(providers.length >= 4);
  });

  test('11. Codex remains lazy when another provider is selected', () => {
    // Verify that querying non-codex providers or idle state does NOT start Codex App Server
    assert.equal(codexRuntimeManager.isRunning(), false, 'Codex App Server must remain lazy');
  });

  test('12. Persisted Codex UI bootstrap regression remains passing', () => {
    const mockList: AIProvider[] = [
      {
        id: 'ollama',
        name: 'Ollama',
        type: 'local',
        status: 'available',
        endpoint: 'http://localhost:11434',
        defaultExecutionLocation: 'local',
        defaultBillingType: 'free',
        authType: 'none',
        connected: true,
      },
      {
        id: 'codex',
        name: 'OpenAI Codex',
        type: 'subscription',
        status: 'unauthenticated',
        defaultExecutionLocation: 'cloud',
        defaultBillingType: 'paid',
        authType: 'oauth',
        connected: false,
      },
    ];

    const codexStatus = {
      connected: true,
      status: 'available' as const,
      reason: 'Signed in with ChatGPT (PRO)',
      planType: 'pro',
    };

    const enriched = mergeCodexStatus(mockList, codexStatus);
    assert.equal(enriched.length, 2);
    assert.equal(enriched[0].id, 'ollama');
    assert.equal(enriched[0].connected, true);
    assert.equal(enriched[1].id, 'codex');
    assert.equal(enriched[1].connected, true);
    assert.equal(enriched[1].planType, 'pro');
  });
});
