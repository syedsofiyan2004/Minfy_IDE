import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import { runtimeAuthService } from '../src/services/runtimeAuthService.js';
import { terminalTicketService } from '../src/services/terminalTicketService.js';
import {
  hostValidationMiddleware,
  corsOriginMiddleware,
  runtimeAuthMiddleware,
  isAllowedHost,
  isAllowedOrigin,
} from '../src/middleware/securityMiddleware.js';
import {
  CredentialStore,
  ICredentialBackend,
  WindowsCredentialBackend,
} from '../src/services/credentialStore.js';

describe('Runtime Authentication & Defense-in-Depth Security (Milestone 4.2)', () => {
  const validToken = runtimeAuthService.getToken();
  let server: http.Server;
  let testPort: number;

  before(async () => {
    const app = express();
    app.use(hostValidationMiddleware);
    app.use(corsOriginMiddleware);
    app.use(express.json());

    // Public endpoint
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    // Protected endpoints
    app.use(runtimeAuthMiddleware);

    app.get('/api/status', (_req, res) => {
      res.json({ success: true, data: { status: 'ok' } });
    });

    app.get('/api/workspaces', (_req, res) => {
      res.json({ success: true, data: [] });
    });

    app.post('/api/workspaces/:id/terminal-ticket', (req, res) => {
      const { ticket, expiresAt } = terminalTicketService.createTicket(req.params.id);
      res.json({ success: true, data: { ticket, expiresAt } });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        testPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('runtime capability token is a 32-byte cryptographic hex token', () => {
    assert.strictEqual(typeof validToken, 'string');
    assert.strictEqual(validToken.length, 64); // 32 bytes in hex = 64 characters
    assert.strictEqual(runtimeAuthService.verifyToken(validToken), true);
    assert.strictEqual(runtimeAuthService.verifyToken('invalid-token'), false);
    assert.strictEqual(runtimeAuthService.verifyToken(''), false);
    assert.strictEqual(runtimeAuthService.verifyToken(undefined), false);
  });

  test('Host validation accepts valid loopback hosts and rejects external/rebound hosts', () => {
    const port = 4560;
    assert.strictEqual(isAllowedHost(`127.0.0.1:${port}`, port), true);
    assert.strictEqual(isAllowedHost(`localhost:${port}`, port), true);
    assert.strictEqual(isAllowedHost(`[::1]:${port}`, port), true);
    assert.strictEqual(isAllowedHost('127.0.0.1', port), true);
    assert.strictEqual(isAllowedHost('localhost', port), true);

    // Reject DNS rebinding and foreign hosts
    assert.strictEqual(isAllowedHost('evil.example:4560', port), false);
    assert.strictEqual(isAllowedHost('attacker.com', port), false);
    assert.strictEqual(isAllowedHost('192.168.1.50:4560', port), false);
    assert.strictEqual(isAllowedHost('', port), false);
    assert.strictEqual(isAllowedHost(undefined, port), false);
  });

  test('CORS origin validation accepts loopback origins and rejects foreign browser origins', () => {
    const port = 4560;
    // No origin (CLI, curl, direct same-origin requests) is allowed
    assert.strictEqual(isAllowedOrigin(undefined, port), true);
    assert.strictEqual(isAllowedOrigin('', port), true);

    // Trusted loopback development origins allowed
    assert.strictEqual(isAllowedOrigin(`http://127.0.0.1:${port}`, port), true);
    assert.strictEqual(isAllowedOrigin(`http://localhost:${port}`, port), true);
    assert.strictEqual(isAllowedOrigin('http://localhost:5173', port), true);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5173', port), true);

    // Foreign web origins strictly rejected
    assert.strictEqual(isAllowedOrigin('https://evil.example', port), false);
    assert.strictEqual(isAllowedOrigin('http://malicious-site.com', port), false);
    assert.strictEqual(isAllowedOrigin('https://attacker.io:4560', port), false);
  });

  test('GET /api/health succeeds without authentication', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.deepStrictEqual(json, { status: 'ok' });
  });

  test('GET /api/status and /api/workspaces reject unauthenticated requests with HTTP 401', async () => {
    // 1. Missing Authorization header
    const res1 = await fetch(`http://127.0.0.1:${testPort}/api/status`);
    assert.strictEqual(res1.status, 401);
    const json1 = await res1.json();
    assert.strictEqual(json1.success, false);
    assert.ok(json1.error?.includes('Runtime authentication required'));

    // 2. Invalid Authorization header
    const res2 = await fetch(`http://127.0.0.1:${testPort}/api/workspaces`, {
      headers: { Authorization: 'Bearer invalid-token-value' },
    });
    assert.strictEqual(res2.status, 401);
  });

  test('Privileged endpoints accept requests with valid Authorization header', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
  });

  test('Requests with foreign Origin (e.g. https://evil.example) are rejected with HTTP 403', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`, {
      headers: {
        Origin: 'https://evil.example',
        Authorization: `Bearer ${validToken}`,
      },
    });
    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.error, 'Forbidden Origin.');
  });

  test('Terminal ticket endpoint requires runtime auth and generates single-use ticket', async () => {
    // 1. Unauthenticated ticket request rejected
    const unauthRes = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/ws-123/terminal-ticket`, {
      method: 'POST',
    });
    assert.strictEqual(unauthRes.status, 401);

    // 2. Authenticated ticket request succeeds
    const authRes = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/ws-123/terminal-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(authRes.status, 200);
    const { data } = await authRes.json();
    assert.ok(data.ticket);

    // 3. Ticket consumption binds to workspace
    const consumed = terminalTicketService.consumeTicket(data.ticket);
    assert.strictEqual(consumed.valid, true);
    assert.strictEqual(consumed.workspaceId, 'ws-123');

    // 4. Reuse rejected
    const reused = terminalTicketService.consumeTicket(data.ticket);
    assert.strictEqual(reused.valid, false);
  });

  test('Windows Credential backend reports windows-dpapi vault and truthful metadata', () => {
    const winBackend = new WindowsCredentialBackend();
    assert.strictEqual(winBackend.type, 'windows-dpapi');
    assert.strictEqual(winBackend.name, 'Windows DPAPI-protected vault');
    assert.strictEqual(winBackend.isPersistent, true);
  });

  test('CredentialStore downgrades backendInfo to session memory if native write fails', async () => {
    // Failing backend test double
    const failingBackend: ICredentialBackend = {
      type: 'windows-dpapi',
      name: 'Failing Windows Vault',
      isPersistent: true,
      async get() { return null; },
      async set() { throw new Error('OS Keyring Locked'); },
      async delete() { return true; },
      async has() { return false; },
    };

    const store = new CredentialStore(failingBackend);
    assert.strictEqual(store.backendInfo().type, 'windows-dpapi');
    assert.strictEqual(store.backendInfo().isPersistent, true);

    // Trigger set failure
    await store.set('test-prov', 'sk-or-fallback');

    // Verification: BackendInfo MUST now truthfully reflect Memory Fallback and NOT claim persistence
    const info = store.backendInfo();
    assert.strictEqual(info.type, 'memory');
    assert.strictEqual(info.isPersistent, false);
    assert.ok(info.name.includes('Memory'));
    assert.strictEqual(await store.get('test-prov'), 'sk-or-fallback');
  });
});
