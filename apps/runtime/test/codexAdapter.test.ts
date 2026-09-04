import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { CodexAdapter } from '../src/services/ai/codex/codexAdapter.js';
import { CodexAppServerClient } from '../src/services/ai/codex/codexAppServerClient.js';
import { codexRuntimeManager } from '../src/services/ai/codex/codexRuntimeManager.js';
import { codexDiscoveryService } from '../src/services/ai/codex/codexDiscovery.js';
import { credentialStore } from '../src/services/credentialStore.js';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { AIStreamEvent } from '@minfy/shared';

describe('OpenAI Codex Adapter & Context Isolation (Milestones 7 & 7.1)', () => {
  let adapter: CodexAdapter;
  let stdin: PassThrough;
  let stdout: PassThrough;
  let mockClient: CodexAppServerClient;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    mockClient = new CodexAppServerClient(stdin, stdout);

    // Auto-respond to initialize handshake on mockClient
    stdin.on('data', (chunk) => {
      const lines = chunk
        .toString()
        .split('\n')
        .filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            stdout.write(JSON.stringify({ id: msg.id, result: { userAgent: 'codex-cli/0.151.0' } }) + '\n');
          }
        } catch {}
      }
    });

    codexRuntimeManager.setMockClient(mockClient);

    // Mock discovery to return available
    codexDiscoveryService.discover = async () => ({
      available: true,
      version: '0.151.0',
      command: 'codex',
      baseArgs: [],
    });

    adapter = new CodexAdapter();
  });

  afterEach(() => {
    codexRuntimeManager.setMockClient(null);
    mockClient.close();
  });

  it('lazy process start correctly detects existing ChatGPT login without CredentialStore', async () => {
    // Intercept account/read
    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'account/read') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: {
                  account: {
                    type: 'chatgpt',
                    email: 'user@example.com',
                    planType: 'plus',
                  },
                  requiresOpenaiAuth: true,
                },
              }) + '\n'
            );
          }
        } catch {}
      }
    });

    const conn = await adapter.getConnectionState(true);
    assert.equal(conn.connected, true);
    assert.equal(conn.status, 'available');
    assert.match(conn.reason || '', /Signed in with ChatGPT \(PLUS\)/);
    assert.equal(conn.planType, 'plus');

    // Verify CredentialStore was NOT touched
    assert.equal(credentialStore.hasCredential('codex'), false);
  });

  it('truly signed-out account reports sign-in required', async () => {
    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'account/read') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: {
                  account: null,
                  requiresOpenaiAuth: true,
                },
              }) + '\n'
            );
          }
        } catch {}
      }
    });

    const conn = await adapter.getConnectionState(true);
    assert.equal(conn.connected, false);
    assert.equal(conn.status, 'unavailable');
    assert.match(conn.reason || '', /Sign in with ChatGPT to use Codex/);
  });

  it('startup failure differs clearly from signed-out state', async () => {
    // Force runtime manager getClient to fail
    codexRuntimeManager.setMockClient(null);
    codexDiscoveryService.discover = async () => ({
      available: true,
      version: '0.151.0',
      command: 'nonexistent-codex-binary-xyz',
      baseArgs: [],
    });

    const conn = await adapter.getConnectionState(true);
    assert.equal(conn.connected, false);
    assert.equal(conn.status, 'unavailable');
    assert.match(conn.reason || '', /Codex App Server could not be started/);
    assert.doesNotMatch(conn.reason || '', /Sign in with ChatGPT/);
  });

  it('dynamically normalizes models, filtering out hidden models and preserving cloud execution semantics', async () => {
    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'model/list') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: {
                  data: [
                    {
                      id: 'gpt-5.6-luna',
                      displayName: 'GPT-5.6 Luna',
                      hidden: false,
                      isDefault: true,
                      inputModalities: ['text', 'image'],
                    },
                    {
                      id: 'gpt-5.4-deprecated',
                      displayName: 'GPT-5.4 Hidden',
                      hidden: true,
                      isDefault: false,
                    },
                  ],
                  nextCursor: null,
                },
              }) + '\n'
            );
          }
        } catch {}
      }
    });

    const models = await adapter.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'gpt-5.6-luna');
    assert.equal(models[0].providerId, 'codex');
    assert.equal(models[0].executionLocation, 'cloud');
    assert.equal(models[0].billingType, 'unknown');
    assert.equal(models[0].supportsStreaming, true);
    assert.equal(models[0].supportsVision, true);
  });

  it('MINFY-PROVIDED CONTEXT ISOLATION: thread/start uses isolated sandbox directory and never workspace path', async () => {
    const events: AIStreamEvent[] = [];
    const workspaceRoot = 'C:\\Projects\\SecretEnterpriseRepo';

    let capturedThreadStartParams: any = null;
    let capturedTurnStartParams: any = null;

    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'account/read') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: { account: { type: 'chatgpt', planType: 'team' }, requiresOpenaiAuth: true },
              }) + '\n'
            );
          } else if (msg.method === 'thread/start') {
            capturedThreadStartParams = msg.params;
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: {
                  thread: { id: 'thread-isolated-1' },
                  model: 'gpt-5.6-luna',
                  cwd: msg.params.cwd,
                },
              }) + '\n'
            );
          } else if (msg.method === 'turn/start') {
            capturedTurnStartParams = msg.params;
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: {
                  turn: { id: 'turn-isolated-1', status: 'inProgress' },
                },
              }) + '\n'
            );

            setTimeout(() => {
              stdout.write(
                JSON.stringify({
                  method: 'item/agentMessage/delta',
                  params: {
                    threadId: 'thread-isolated-1',
                    turnId: 'turn-isolated-1',
                    itemId: 'item-1',
                    delta: 'Hello prompt world',
                  },
                }) + '\n'
              );

              stdout.write(
                JSON.stringify({
                  method: 'turn/completed',
                  params: {
                    threadId: 'thread-isolated-1',
                    turn: { id: 'turn-isolated-1', status: 'completed' },
                  },
                }) + '\n'
              );
            }, 10);
          }
        } catch {}
      }
    });

    const usage = await adapter.generate(
      {
        providerId: 'codex',
        modelId: 'gpt-5.6-luna',
        prompt: 'Explain what an interface is.',
      },
      (ev) => events.push(ev)
    );

    assert.ok(capturedThreadStartParams, 'thread/start must be called');
    assert.ok(capturedTurnStartParams, 'turn/start must be called');

    // 1. Working directory is isolated prompt sandbox, NEVER workspace
    const sandboxDir = adapter.getSandboxDirectory();
    assert.equal(capturedThreadStartParams.cwd, sandboxDir);
    assert.notEqual(capturedThreadStartParams.cwd, workspaceRoot);

    // 2. Strict read-only sandbox and never approval
    assert.equal(capturedThreadStartParams.sandbox, 'read-only');
    assert.equal(capturedThreadStartParams.approvalPolicy, 'never');
    assert.equal(capturedThreadStartParams.ephemeral, true);

    // 3. Confirm workspace path, files, and git info are completely absent
    const serializedPayload = JSON.stringify(capturedThreadStartParams) + JSON.stringify(capturedTurnStartParams);
    assert.equal(serializedPayload.includes(workspaceRoot), false);
    assert.equal(serializedPayload.includes('SecretEnterpriseRepo'), false);

    // 4. Stream events received
    assert.ok(events.some((e) => e.type === 'started'));
    assert.ok(events.some((e) => e.type === 'text-delta' && e.textDelta === 'Hello prompt world'));
    assert.ok(events.some((e) => e.type === 'completed'));
    assert.equal(usage.status, 'completed');
  });

  it('RACE GUARD: immediate turn completion in the same tick cannot be lost', async () => {
    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'account/read') {
            stdout.write(JSON.stringify({ id: msg.id, result: { account: { type: 'chatgpt' } } }) + '\n');
          } else if (msg.method === 'thread/start') {
            stdout.write(JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-race-1' } } }) + '\n');
          } else if (msg.method === 'turn/start') {
            // Write turn/start response AND turn/completed notification synchronously in the exact same write!
            const batch =
              JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-race-1', status: 'inProgress' } } }) +
              '\n' +
              JSON.stringify({
                method: 'item/agentMessage/delta',
                params: { threadId: 'thread-race-1', turnId: 'turn-race-1', delta: 'Immediate answer' },
              }) +
              '\n' +
              JSON.stringify({
                method: 'turn/completed',
                params: { threadId: 'thread-race-1', turn: { id: 'turn-race-1', status: 'completed' } },
              }) +
              '\n';
            stdout.write(batch);
          }
        } catch {}
      }
    });

    const events: AIStreamEvent[] = [];
    const usagePromise = adapter.generate(
      {
        providerId: 'codex',
        modelId: 'gpt-5.6-luna',
        prompt: 'Immediate question',
      },
      (ev) => events.push(ev)
    );

    const usage = await usagePromise;
    assert.equal(usage.status, 'completed');
    assert.ok(events.some((e) => e.type === 'text-delta' && e.textDelta === 'Immediate answer'));
    assert.ok(events.some((e) => e.type === 'completed'));
  });

  it('sends turn/interrupt on cancellation and marks status as cancelled while keeping client alive', async () => {
    let interruptSent = false;

    stdin.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'account/read') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: { account: { type: 'chatgpt', planType: 'pro' }, requiresOpenaiAuth: true },
              }) + '\n'
            );
          } else if (msg.method === 'thread/start') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: { thread: { id: 'thread-cancel-1' }, model: 'gpt-5.6-luna', cwd: '/tmp' },
              }) + '\n'
            );
          } else if (msg.method === 'turn/start') {
            stdout.write(
              JSON.stringify({
                id: msg.id,
                result: { turn: { id: 'turn-cancel-1', status: 'inProgress' } },
              }) + '\n'
            );
          } else if (msg.method === 'turn/interrupt') {
            interruptSent = true;
            stdout.write(JSON.stringify({ id: msg.id, result: null }) + '\n');
            stdout.write(
              JSON.stringify({
                method: 'turn/completed',
                params: { threadId: 'thread-cancel-1', turn: { id: 'turn-cancel-1', status: 'interrupted' } },
              }) + '\n'
            );
          }
        } catch {}
      }
    });

    const abortCtrl = new AbortController();
    const genPromise = adapter.generate(
      {
        providerId: 'codex',
        modelId: 'gpt-5.6-luna',
        prompt: 'Long prompt',
      },
      () => {},
      abortCtrl.signal
    );

    await new Promise((r) => setTimeout(r, 20));
    abortCtrl.abort();

    const usage = await genPromise;
    assert.equal(interruptSent, true);
    assert.equal(usage.status, 'cancelled');
  });

  it('coexists in AIProviderRegistry alongside Ollama, OpenRouter, and Bedrock without interference', async () => {
    codexRuntimeManager.setMockClient(null);

    const providers = await aiProviderRegistry.listProviders();
    const codex = providers.find((p) => p.id === 'codex');
    const ollama = providers.find((p) => p.id === 'ollama');
    const openrouter = providers.find((p) => p.id === 'openrouter');
    const bedrock = providers.find((p) => p.id === 'bedrock');

    assert.ok(codex, 'Codex must be in registry');
    assert.ok(ollama, 'Ollama must be in registry');
    assert.ok(openrouter, 'OpenRouter must be in registry');
    assert.ok(bedrock, 'Bedrock must be in registry');

    assert.equal(codex.type, 'subscription');
    assert.equal(aiProviderRegistry.isBuiltIn('codex'), true);
  });
});
