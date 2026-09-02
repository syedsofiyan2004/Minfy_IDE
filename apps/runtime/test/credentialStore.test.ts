import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  CredentialStore,
  MemoryCredentialBackend,
  WindowsCredentialBackend,
} from '../src/services/credentialStore.js';

describe('CredentialStore Multi-Backend & Secret Security (Milestone 4.1)', () => {
  test('MemoryCredentialBackend stores, retrieves, and deletes in session memory', async () => {
    const mem = new MemoryCredentialBackend();
    assert.strictEqual(mem.type, 'memory');
    assert.strictEqual(mem.isPersistent, false);
    assert.strictEqual(await mem.has('openrouter'), false);
    assert.strictEqual(await mem.get('openrouter'), null);

    await mem.set('openrouter', 'sk-or-session-test');
    assert.strictEqual(await mem.has('openrouter'), true);
    assert.strictEqual(await mem.get('openrouter'), 'sk-or-session-test');

    const deleted = await mem.delete('openrouter');
    assert.strictEqual(deleted, true);
    assert.strictEqual(await mem.has('openrouter'), false);
    assert.strictEqual(await mem.get('openrouter'), null);
  });

  test('CredentialStore facade provides non-secret backend metadata only', () => {
    const store = new CredentialStore(new MemoryCredentialBackend());
    const info = store.backendInfo();

    assert.strictEqual(info.type, 'memory');
    assert.strictEqual(info.name, 'Session Memory');
    assert.strictEqual(info.isPersistent, false);

    // Verify metadata NEVER contains credential fields
    assert.strictEqual((info as any).apiKey, undefined);
    assert.strictEqual((info as any).secret, undefined);
    assert.strictEqual((info as any).token, undefined);
  });

  test('CredentialStore hot cache enables synchronous retrieval for runtime adapters', async () => {
    const mem = new MemoryCredentialBackend();
    const store = new CredentialStore(mem);

    await store.set('openrouter', 'sk-or-hotcache-test');
    assert.strictEqual(store.hasCredential('openrouter'), true);
    assert.strictEqual(store.getCredential('openrouter'), 'sk-or-hotcache-test');

    await store.delete('openrouter');
    assert.strictEqual(store.hasCredential('openrouter'), false);
    assert.strictEqual(store.getCredential('openrouter'), undefined);
  });

  test('trims surrounding whitespace from entered credentials', async () => {
    const mem = new MemoryCredentialBackend();
    const store = new CredentialStore(mem);

    await store.set('openrouter', '   sk-or-spaced-key   \n');
    assert.strictEqual(await store.get('openrouter'), 'sk-or-spaced-key');
    assert.strictEqual(store.getCredential('openrouter'), 'sk-or-spaced-key');
    await store.delete('openrouter');
  });
});
