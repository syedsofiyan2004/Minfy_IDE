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

describe('Runtime Authentication & Defense-in-Depth Security (Milestone 4.2.2)', () => {
  const validToken = runtimeAuthService.getToken();
  let server: http.Server;
  let testPort: number;

  before(async () => {
    const app = express();
    app.use(hostValidationMiddleware);
    app.use(corsOriginMiddleware);
    app.use(express.json());

    // Public health probe endpoint
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

  test('Host validation accepts valid loopback hosts with matching port and rejects port mismatches / external hosts', () => {
    const port = 4560;
    // Accepted valid loopbacks with matching port
    assert.strictEqual(isAllowedHost(`127.0.0.1:${port}`, port), true);
    assert.strictEqual(isAllowedHost(`localhost:${port}`, port), true);
    assert.strictEqual(isAllowedHost(`[::1]:${port}`, port), true);
    assert.strictEqual(isAllowedHost('127.0.0.1', port), true);
    assert.strictEqual(isAllowedHost('localhost', port), true);

    // Rejected loopbacks with wrong port
    assert.strictEqual(isAllowedHost('localhost:9999', port), false);
    assert.strictEqual(isAllowedHost('127.0.0.1:9999', port), false);
    assert.strictEqual(isAllowedHost('[::1]:9999', port), false);

    // Rejected DNS rebinding, LAN IPs, and foreign hosts
    assert.strictEqual(isAllowedHost('evil.example:4560', port), false);
    assert.strictEqual(isAllowedHost('attacker.com', port), false);
    assert.strictEqual(isAllowedHost('192.168.1.50:4560', port), false);
    assert.strictEqual(isAllowedHost('', port), false);
    assert.strictEqual(isAllowedHost(undefined, port), false);
  });

  test('Tightened Origin policy accepts runtime loopback and environment dev ports while rejecting unapproved origins', () => {
    const port = 4560;
    // No origin (CLI, curl, direct same-origin requests) is allowed
    assert.strictEqual(isAllowedOrigin(undefined, port), true);
    assert.strictEqual(isAllowedOrigin('', port), true);

    // Exact runtime port allowed
    assert.strictEqual(isAllowedOrigin(`http://127.0.0.1:${port}`, port), true);
    assert.strictEqual(isAllowedOrigin(`http://localhost:${port}`, port), true);

    // Unapproved arbitrary localhost ports rejected
    assert.strictEqual(isAllowedOrigin('http://localhost:9999', port), false);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:8080', port), false);

    // Foreign web origins strictly rejected
    assert.strictEqual(isAllowedOrigin('https://evil.example', port), false);
    assert.strictEqual(isAllowedOrigin('http://malicious-site.com', port), false);
    assert.strictEqual(isAllowedOrigin('https://attacker.io:4560', port), false);
  });

  test('Production mode rejects Vite dev origins by default unless explicitly configured in MINFY_ALLOWED_DEV_ORIGINS', () => {
    const origEnv = process.env.NODE_ENV;
    const origCustom = process.env.MINFY_ALLOWED_DEV_ORIGINS;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.MINFY_ALLOWED_DEV_ORIGINS;

      // In production without explicit config, Vite dev origin 5173 is rejected
      assert.strictEqual(isAllowedOrigin('http://localhost:5173', 4560), false);
      assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5173', 4560), false);

      // Explicitly configuring MINFY_ALLOWED_DEV_ORIGINS permits specific origin
      process.env.MINFY_ALLOWED_DEV_ORIGINS = 'http://localhost:5173,http://custom-dev:3000';
      assert.strictEqual(isAllowedOrigin('http://localhost:5173', 4560), true);
      assert.strictEqual(isAllowedOrigin('http://custom-dev:3000', 4560), true);
      assert.strictEqual(isAllowedOrigin('http://localhost:9999', 4560), false);
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.MINFY_ALLOWED_DEV_ORIGINS = origCustom;
    }
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

  test('Terminal ticket service enforces single-use, TTL expiration, invalid rejection, and workspace binding', async () => {
    const ticketService = new terminalTicketService.constructor(500); // 500ms TTL

    // 1. Invalid ticket rejected
    assert.strictEqual(ticketService.consumeTicket('invalid-candidate').valid, false);
    assert.strictEqual(ticketService.consumeTicket(undefined).valid, false);

    // 2. Ticket generation
    const { ticket, expiresAt } = ticketService.createTicket('ws-lifecycle-test');
    assert.ok(ticket && ticket.length >= 32);
    assert.ok(expiresAt > Date.now());

    // 3. Single-use consumption succeeds and returns bound workspace
    const res1 = ticketService.consumeTicket(ticket);
    assert.strictEqual(res1.valid, true);
    assert.strictEqual(res1.workspaceId, 'ws-lifecycle-test');

    // 4. Ticket reuse fails
    const res2 = ticketService.consumeTicket(ticket);
    assert.strictEqual(res2.valid, false);

    // 5. Expired ticket fails
    const { ticket: expTicket } = ticketService.createTicket('ws-expired-test');
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(ticketService.consumeTicket(expTicket).valid, false);
  });

  test('Windows Credential backend reports windows-dpapi vault and truthful metadata', () => {
    const winBackend = new WindowsCredentialBackend();
    assert.strictEqual(winBackend.type, 'windows-dpapi');
    assert.strictEqual(winBackend.name, 'Windows DPAPI-protected vault');
    assert.strictEqual(winBackend.isPersistent, true);
  });

  test('CredentialStore downgrades backendInfo to session memory if native write fails', async () => {
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

    await store.set('test-prov', 'sk-or-fallback');

    const info = store.backendInfo();
    assert.strictEqual(info.type, 'memory');
    assert.strictEqual(info.isPersistent, false);
    assert.ok(info.name.includes('Memory'));
    assert.strictEqual(await store.get('test-prov'), 'sk-or-fallback');
  });
});
