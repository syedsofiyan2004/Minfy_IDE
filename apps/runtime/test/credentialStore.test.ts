import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CredentialStore } from '../src/services/credentialStore.js';

describe('CredentialStore Local Secret Management', () => {
  const tmpDir = path.join(os.tmpdir(), `minfy-cred-test-${Date.now()}`);
  const credFile = path.join(tmpDir, 'test-credentials.json');

  before(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('stores, retrieves, and checks credential existence', () => {
    const store = new CredentialStore(credFile);
    assert.strictEqual(store.hasCredential('openrouter'), false);
    assert.strictEqual(store.getCredential('openrouter'), undefined);

    store.setCredential('openrouter', 'sk-or-test-key-12345');
    assert.strictEqual(store.hasCredential('openrouter'), true);
    assert.strictEqual(store.getCredential('openrouter'), 'sk-or-test-key-12345');
  });

  test('persists to disk and reloads on new instance', () => {
    const store2 = new CredentialStore(credFile);
    assert.strictEqual(store2.hasCredential('openrouter'), true);
    assert.strictEqual(store2.getCredential('openrouter'), 'sk-or-test-key-12345');
  });

  test('deletes credential cleanly upon disconnect', () => {
    const store = new CredentialStore(credFile);
    const deleted = store.deleteCredential('openrouter');
    assert.strictEqual(deleted, true);
    assert.strictEqual(store.hasCredential('openrouter'), false);
    assert.strictEqual(store.getCredential('openrouter'), undefined);

    const storeReloaded = new CredentialStore(credFile);
    assert.strictEqual(storeReloaded.hasCredential('openrouter'), false);
  });

  test('trims surrounding whitespace from entered credentials', () => {
    const store = new CredentialStore(credFile);
    store.setCredential('openrouter', '   sk-or-spaced-key   \n');
    assert.strictEqual(store.getCredential('openrouter'), 'sk-or-spaced-key');
    store.deleteCredential('openrouter');
  });
});
