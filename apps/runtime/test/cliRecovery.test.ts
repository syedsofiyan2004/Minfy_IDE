import { test, describe } from 'node:test';
import assert from 'node:assert';
import { decideRuntimeRecovery } from '../../../cli/dist/index.js';

describe('Authenticated Runtime Instance Identity & Safe Ownership (Milestone 4.2.3)', () => {
  const dummyToken = 'a'.repeat(64);
  const instanceA = '11111111-2222-3333-4444-555555555555';
  const instanceB = '99999999-8888-7777-6666-555555555555';

  test('Case 1: No runtime running and no state file -> start fresh daemon', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: false,
      state: { valid: false },
      authenticatedIdentity: { authenticated: false },
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'start_fresh');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 2: Health succeeds, token authenticates, and runtime identity matches state -> reuse existing daemon instantly', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 12345, token: dummyToken, runtimeInstanceId: instanceA },
      authenticatedIdentity: { authenticated: true, pid: 12345, runtimeInstanceId: instanceA },
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'reuse_existing');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 3: Runtime not running and stale state exists -> clear stale state and start fresh', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: false,
      state: { valid: true, port: 4560, pid: 99999, token: dummyToken, runtimeInstanceId: instanceA },
      authenticatedIdentity: { authenticated: false },
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'clear_stale_and_start');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 4: Port occupied but state file is missing -> unverified, DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: false },
      authenticatedIdentity: { authenticated: false },
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
    assert.ok(decision.reason.includes('NOT be terminated'));
  });

  test('Case 5: Token fails authentication -> unverified, DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 44444, token: 'invalid-or-stale-token', runtimeInstanceId: instanceA },
      authenticatedIdentity: { authenticated: false },
      isRestartRequested: false,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 6: Explicit restart requested with valid token + matching PID + matching instance ID -> safe to terminate and restart', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 55555, token: dummyToken, runtimeInstanceId: instanceA },
      authenticatedIdentity: { authenticated: true, pid: 55555, runtimeInstanceId: instanceA },
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'safe_terminate_and_restart');
    assert.strictEqual(decision.pidToTerminate, 55555);
  });

  test('Case 7 (CRITICAL REGRESSION): Token authenticates, but state.pid differs from authenticated runtime PID -> DO NOT KILL', () => {
    // Simulates state having an unrelated/reused PID (e.g. 77777), while authenticated runtime is PID 55555
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 77777, token: dummyToken, runtimeInstanceId: instanceA },
      authenticatedIdentity: { authenticated: true, pid: 55555, runtimeInstanceId: instanceA },
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
    assert.ok(decision.reason.includes('identity mismatch') || decision.reason.includes('will not terminate'));
  });

  test('Case 8: Token authenticates and PID matches, but runtimeInstanceId mismatches -> DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: true, port: 4560, pid: 55555, token: dummyToken, runtimeInstanceId: instanceB },
      authenticatedIdentity: { authenticated: true, pid: 55555, runtimeInstanceId: instanceA },
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 9: Legacy state without runtimeInstanceId -> cannot verify instance identity, DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: true,
      state: { valid: false, port: 4560, pid: 55555, token: dummyToken }, // legacy state missing runtimeInstanceId
      authenticatedIdentity: { authenticated: true, pid: 55555, runtimeInstanceId: instanceA },
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });

  test('Case 10: Foreign service listening on port 4560 (port bound but health check failed) -> DO NOT KILL', () => {
    const decision = decideRuntimeRecovery({
      isHealthy: false,
      isPortBound: true,
      state: { valid: false },
      authenticatedIdentity: { authenticated: false },
      isRestartRequested: true,
    });

    assert.strictEqual(decision.action, 'port_occupied_unverified');
    assert.strictEqual(decision.pidToTerminate, undefined);
  });
});
