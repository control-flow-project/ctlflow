import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { testClock, withClock } from '../scripts/test-support/clock.js';
import { listenerOptions } from '../apps/client/src/listener-options.js';

test('controlled clocks preserve deadline boundaries, cancellation and recurring cadence without changing native time', withClock(async (_scope, clock) => {
  const wall = Date.now(), monotonic = performance.now(), order: number[] = [];
  const cancelled = clock.schedule(() => assert.fail('Cancelled timer ran'), 20); cancelled();
  const recurring = clock.schedule(() => { order.push(clock.now()); }, 10, true);
  const deadline = clock.deadline(25);
  await clock.advance(24); assert.equal(deadline.aborted, false); assert.deepEqual(order, [10, 20]);
  await clock.advance(1); assert.equal(deadline.aborted, true); assert.equal(deadline.reason.name, 'TimeoutError');
  await clock.advance(5); recurring(); await clock.advance(40); assert.deepEqual(order, [10, 20, 30]);
  const stop = new AbortController(), delay = clock.delay(1000, stop.signal);
  stop.abort(new Error('Exact cancellation')); await assert.rejects(delay, /Exact cancellation/);
  const before = performance.now(); await clock.advance(60_000);
  assert(performance.now() - before < 1000, 'Virtual minutes must not become elapsed-time waits');
  assert(Date.now() >= wall); assert(performance.now() >= monotonic);
}));

test('clock disposal is isolated and default CLI options share strict native bounds', async scope => {
  const first = testClock(scope), second = testClock(scope);
  cleanup(scope, first.close); cleanup(scope, second.close);
  first.schedule(() => assert.fail('Disposed timer ran'), 1); first.close();
  await first.advance(10); assert.equal(second.now(), 0);
  assert.deepEqual(listenerOptions({}), { pollMs: 10000, debounceMs: 10000, reconcileMs: 120000 });
  for (const invalid of ['-1', '60001', 'NaN', '0.5']) assert.throws(() => listenerOptions({ 'debounce-ms': invalid }));
});
