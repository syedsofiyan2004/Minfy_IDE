import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { CodexAppServerClient } from '../src/services/ai/codex/codexAppServerClient.js';
import { CodexDiscoveryService } from '../src/services/ai/codex/codexDiscovery.js';
import { CodexRuntimeManager } from '../src/services/ai/codex/codexRuntimeManager.js';

describe('OpenAI Codex Process Lifecycle & Stdio JSONL Protocol (Milestone 7)', () => {
  let stdin: PassThrough;
  let stdout: PassThrough;
  let client: CodexAppServerClient;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    client = new CodexAppServerClient(stdin, stdout);
  });

  afterEach(() => {
    client.close();
  });

  it('correlates request IDs correctly over stdio JSONL', async () => {
    const responsePromise = client.initialize({
      name: 'minfy-test',
      title: 'Minfy IDE Test',
      version: '1.0.0',
    });

    let sentData = '';
    stdin.on('data', (chunk) => {
      sentData += chunk.toString();
    });

    // Allow event loop to send request
    await new Promise((r) => setImmediate(r));

    const sentReq = JSON.parse(sentData.trim());
    assert.equal(sentReq.method, 'initialize');
    assert.equal(sentReq.id, '1');
    assert.equal(sentReq.params.clientInfo.name, 'minfy-test');

    // Simulate server response
    stdout.write(
      JSON.stringify({
        id: '1',
        result: {
          userAgent: 'codex-cli/0.151.0',
          codexHome: '/home/user/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        },
      }) + '\n'
    );

    const res = await responsePromise;
    assert.equal(res.userAgent, 'codex-cli/0.151.0');
    assert.equal(res.platformFamily, 'unix');
  });

  it('enforces exact protocol handshake order: initialize -> response -> initialized notification -> account/read', async () => {
    const sentLines: string[] = [];
    stdin.on('data', (chunk) => {
      const lines = chunk
        .toString()
        .split('\n')
        .filter((l: string) => l.trim());
      sentLines.push(...lines);
    });

    // Start initialization
    const initPromise = client.initialize({ name: 'minfy-test' });

    // Concurrently trigger account/read before initialization is answered
    const accountPromise = client.getAccount();

    await new Promise((r) => setImmediate(r));

    // At this point, ONLY initialize request should have been sent over stdio
    assert.equal(sentLines.length, 1, 'Only initialize request should be sent before handshake completes');
    const firstReq = JSON.parse(sentLines[0]);
    assert.equal(firstReq.method, 'initialize');
    assert.equal(firstReq.id, '1');

    // Simulate server returning initialize response
    stdout.write(
      JSON.stringify({
        id: '1',
        result: { userAgent: 'codex-cli/0.151.0' },
      }) + '\n'
    );

    // Allow event loop to process response and send initialized notification + queued account/read
    await new Promise((r) => setImmediate(r));

    await initPromise;

    // Now sentLines should contain:
    // [0] {"id":"1","method":"initialize",...}
    // [1] {"method":"initialized"}
    // [2] {"id":"2","method":"account/read",...}
    assert.equal(sentLines.length, 3);
    const notification = JSON.parse(sentLines[1]);
    assert.equal(notification.method, 'initialized');
    assert.equal(notification.id, undefined, 'initialized must be a notification without id');

    const accountReq = JSON.parse(sentLines[2]);
    assert.equal(accountReq.method, 'account/read');
    assert.equal(accountReq.id, '2');

    // Respond to account/read
    stdout.write(
      JSON.stringify({
        id: '2',
        result: { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true },
      }) + '\n'
    );

    const acc = await accountPromise;
    assert.equal(acc.account?.type, 'chatgpt');
    assert.equal(client.isReady(), true);
  });

  it('rejects request immediately if handshake was never initiated', async () => {
    await assert.rejects(
      client.getAccount(),
      /Codex App Server handshake has not been performed/
    );
  });

  it('handles multiple concurrent requests after handshake', async () => {
    // Perform handshake
    const initP = client.initialize();
    await new Promise((r) => setImmediate(r));
    stdout.write(JSON.stringify({ id: '1', result: {} }) + '\n');
    await initP;

    const req1 = client.getAccount();
    const req2 = client.listModels();

    let lines: string[] = [];
    stdin.on('data', (chunk) => {
      lines = lines.concat(
        chunk
          .toString()
          .split('\n')
          .filter((l: string) => l.trim())
      );
    });

    await new Promise((r) => setImmediate(r));

    // Respond out of order: req 3 (listModels) first, then req 2 (getAccount)
    stdout.write(
      JSON.stringify({
        id: '3',
        result: { data: [{ id: 'gpt-5.6-luna', displayName: 'GPT 5.6 Luna', hidden: false, isDefault: true }], nextCursor: null },
      }) + '\n'
    );

    stdout.write(
      JSON.stringify({
        id: '2',
        result: { account: { type: 'chatgpt', planType: 'plus', email: null }, requiresOpenaiAuth: true },
      }) + '\n'
    );

    const [acc, models] = await Promise.all([req1, req2]);
    assert.equal(acc.account?.type, 'chatgpt');
    assert.equal(models.data[0].id, 'gpt-5.6-luna');
  });

  it('malformed JSON line does not crash client or reject valid requests', async () => {
    const initP = client.initialize();
    await new Promise((r) => setImmediate(r));
    stdout.write(JSON.stringify({ id: '1', result: {} }) + '\n');
    await initP;

    const req = client.getAccount();

    await new Promise((r) => setImmediate(r));

    // Feed garbage lines
    stdout.write('INVALID JSON LINE\n');
    stdout.write('{ incomplete json ...\n');
    stdout.write('\n');

    // Feed valid response
    stdout.write(
      JSON.stringify({
        id: '2',
        result: { account: null, requiresOpenaiAuth: true },
      }) + '\n'
    );

    const res = await req;
    assert.equal(res.account, null);
  });

  it('safely declines command execution approval with exact documented schema', async () => {
    let responseSent = '';
    stdin.on('data', (chunk) => {
      responseSent += chunk.toString();
    });

    let declinedEvent: any = null;
    client.on('serverRequestDeclined', (e) => {
      declinedEvent = e;
    });

    // Server sends command approval request
    stdout.write(
      JSON.stringify({
        id: 'server-cmd-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'rm -rf /' },
      }) + '\n'
    );

    await new Promise((r) => setImmediate(r));

    assert.ok(declinedEvent);
    assert.equal(declinedEvent.id, 'server-cmd-1');

    const sentJson = JSON.parse(responseSent.trim());
    assert.equal(sentJson.id, 'server-cmd-1');
    assert.deepEqual(sentJson.result, { decision: 'decline' });
  });

  it('safely declines file change approval with exact documented schema', async () => {
    let responseSent = '';
    stdin.on('data', (chunk) => {
      responseSent += chunk.toString();
    });

    let declinedEvent: any = null;
    client.on('serverRequestDeclined', (e) => {
      declinedEvent = e;
    });

    // Server sends file change approval request
    stdout.write(
      JSON.stringify({
        id: 'server-file-1',
        method: 'item/fileChange/requestApproval',
        params: { path: '/etc/hosts', patch: '...' },
      }) + '\n'
    );

    await new Promise((r) => setImmediate(r));

    assert.ok(declinedEvent);
    assert.equal(declinedEvent.id, 'server-file-1');

    const sentJson = JSON.parse(responseSent.trim());
    assert.equal(sentJson.id, 'server-file-1');
    assert.deepEqual(sentJson.result, { decision: 'decline' });
  });

  it('responds with standard JSON-RPC method-not-found error for unknown server-initiated requests', async () => {
    let responseSent = '';
    stdin.on('data', (chunk) => {
      responseSent += chunk.toString();
    });

    let unsupportedEvent: any = null;
    client.on('serverRequestUnsupported', (e) => {
      unsupportedEvent = e;
    });

    stdout.write(
      JSON.stringify({
        id: 'unknown-req-99',
        method: 'experimental/mcpElicitation',
        params: {},
      }) + '\n'
    );

    await new Promise((r) => setImmediate(r));

    assert.ok(unsupportedEvent);
    assert.equal(unsupportedEvent.id, 'unknown-req-99');

    const sentJson = JSON.parse(responseSent.trim());
    assert.equal(sentJson.id, 'unknown-req-99');
    assert.equal(sentJson.error.code, -32601);
    assert.match(sentJson.error.message, /Method not found/);
  });

  it('rejects pending requests cleanly when connection closes', async () => {
    const initP = client.initialize();
    await new Promise((r) => setImmediate(r));
    stdout.write(JSON.stringify({ id: '1', result: {} }) + '\n');
    await initP;

    const req = client.getAccount();
    await new Promise((r) => setImmediate(r));

    client.close('Process exited unexpectedly');

    await assert.rejects(req, /Process exited unexpectedly/);
  });

  it('executable discovery handles missing executable gracefully', async () => {
    const discovery = new CodexDiscoveryService();
    // Point to non-existent executable
    const origEnv = process.env.CODEX_EXECUTABLE;
    process.env.CODEX_EXECUTABLE = '/path/does/not/exist/codex';

    try {
      const res = await discovery.discover();
      assert.equal(res.available, false);
      assert.match(res.reason || '', /not found/i);
    } finally {
      if (origEnv !== undefined) {
        process.env.CODEX_EXECUTABLE = origEnv;
      } else {
        delete process.env.CODEX_EXECUTABLE;
      }
    }
  });

  it('runtime manager tracks login sessions and handles cancellation', async () => {
    const mgr = new CodexRuntimeManager();
    const session = mgr.registerLoginSession('login-123', 'https://chatgpt.com/auth');
    assert.equal(session.loginId, 'login-123');
    assert.equal(session.status, 'pending');

    const retrieved = mgr.getLoginSession('login-123');
    assert.equal(retrieved?.authUrl, 'https://chatgpt.com/auth');

    const cancelled = mgr.cancelLoginSession('login-123');
    assert.equal(cancelled, true);
    assert.equal(mgr.getLoginSession('login-123'), undefined);
  });
});
