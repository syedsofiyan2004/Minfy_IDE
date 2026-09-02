import { test, describe } from 'node:test';
import assert from 'node:assert';
import { decideRuntimeRecovery } from '../../../cli/dist/index.js';

describe('Safe Runtime Process Ownership & CLI Recovery (Milestone 4.2.2)', () => {
  const dummyToken = 'a'.repeat(64);

  test('Case 1: No runtime running and no state file -> start fresh daemon', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: false,
      state: { valid: false },
      isTokenAuthed: false,
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'start_fresh');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 2: Health succeeds and token authenticates -> reuse existing daemon instantly', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 12345, token: dummyToken },
      isTokenAuthed: true,
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'reuse_existing');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 3: Runtime not running and stale state exists -> clear stale state and start fresh', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: false,
      state: { valid: true, port: 4560, pid: 99999, token: dummyToken },
      isTokenAuthed: false,
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'clear_stale_and_start');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 4: Port occupied but state file is missing -> unverified, DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: false },
      isTokenAuthed: false,
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
    assert.ok(decision.reason.includes('NOT be terminated'));
  });

  test('Case 5: State PID is alive but token fails authentication -> unverified, DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 44444, token: 'invalid-or-stale-token' },
      isTokenAuthed: false,
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 6: Explicit restart requested on authenticated Minfy runtime -> safe to terminate and restart', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 55555, token: dummyToken },
      isTokenAuthed: true,
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'safe_terminate_and_restart');
    assert.strictEqual(decision.pidToTerminate, 55555);
  });

  test('Case 7: OS PID reuse by unrelated process (token invalid) -> PID alone does NOT permit termination', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 55555, token: 'mismatched-token' },
      isTokenAuthed: false,
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
    assert.ok(decision.reason.includes('will not terminate it automatically'));
  });

  test('Case 8: --restart-runtime with unrelated foreign process on port 4560 -> unrelated process is never terminated', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: false }, // Foreign server has no Minfy state
      isTokenAuthed: false,
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });
});
