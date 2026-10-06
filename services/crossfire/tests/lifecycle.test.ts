import test from 'node:test';
import assert from 'node:assert/strict';
import { canRecoverFailure, listenerStop } from '@ctlflow/crossfire-kernel/lifecycle';

test('transport cancellation is recoverable; intentional stops, authority failures and invalid checkpoints remain permanent', () => {
  for (const code of ['native', 'unavailable', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ABORT_ERR']) {
    assert.equal(canRecoverFailure(Object.assign(new Error(code), { code })), true, code);
  }
  assert.equal(canRecoverFailure(new DOMException('Canceled transport', 'AbortError')), true);
  assert.equal(canRecoverFailure(new DOMException('Timed-out transport', 'TimeoutError')), true);
  assert.equal(canRecoverFailure(new Error('Unexpected runtime failure')), true);
  for (const code of ['invalid', 'unauthorized', 'forbidden', 'missing', 'conflict', 'stale_revision', 'capacity', 20]) {
    assert.equal(canRecoverFailure({ code, message: 'Do not retry' }), false, String(code));
  }
  assert.equal(canRecoverFailure(new DOMException('Invalid operation', 'InvalidStateError')), false);
  assert.equal(canRecoverFailure(listenerStop('Owner stopped execution')), false);
});
