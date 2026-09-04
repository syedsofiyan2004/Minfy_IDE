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

  it('handles multiple concurrent requests and correlates responses accurately', async () => {
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

    // Respond out of order: req 2 first, then req 1
    stdout.write(
      JSON.stringify({
        id: '2',
        result: { data: [{ id: 'gpt-5.6-luna', displayName: 'GPT 5.6 Luna', hidden: false, isDefault: true }], nextCursor: null },
      }) + '\n'
    );

    stdout.write(
      JSON.stringify({
        id: '1',
        result: { account: { type: 'chatgpt', planType: 'plus', email: null }, requiresOpenaiAuth: true },
      }) + '\n'
    );

    const [acc, models] = await Promise.all([req1, req2]);
    assert.equal(acc.account?.type, 'chatgpt');
    assert.equal(models.data[0].id, 'gpt-5.6-luna');
  });

  it('malformed JSON line does not crash client or reject valid requests', async () => {
    const req = client.getAccount();

    await new Promise((r) => setImmediate(r));

    // Feed garbage lines
    stdout.write('INVALID JSON LINE\n');
    stdout.write('{ incomplete json ...\n');
    stdout.write('\n');

    // Feed valid response
    stdout.write(
      JSON.stringify({
        id: '1',
        result: { account: null, requiresOpenaiAuth: true },
      }) + '\n'
    );

    const res = await req;
    assert.equal(res.account, null);
  });

  it('safely denies server-initiated approval requests for command execution and file mutation', async () => {
    let responseSent = '';
    stdin.on('data', (chunk) => {
      responseSent += chunk.toString();
    });

    let deniedEvent: any = null;
    client.on('serverRequestDenied', (e) => {
      deniedEvent = e;
    });

    // Server sends an approval request
    stdout.write(
      JSON.stringify({
        id: 'server-req-42',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'rm -rf /' },
      }) + '\n'
    );

    await new Promise((r) => setImmediate(r));

    assert.ok(deniedEvent);
    assert.equal(deniedEvent.id, 'server-req-42');

    const sentJson = JSON.parse(responseSent.trim());
    assert.equal(sentJson.id, 'server-req-42');
    assert.equal(sentJson.result.decision, 'decline');
  });

  it('rejects pending requests cleanly when connection closes', async () => {
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
