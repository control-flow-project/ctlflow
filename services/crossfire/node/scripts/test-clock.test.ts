import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { testClock } from './test-support/clock.js';

test('observing real native I/O never consumes controlled maintenance time', async scope => {
  const clock = testClock(scope);
  let ready = false, callbacks = 0;
  clock.schedule(() => { callbacks++; }, 1);
  const operation = yieldLoop().then(() => { ready = true; });
  await clock.observe(() => ready);
  await operation;
  assert.equal(clock.now(), 0);
  assert.equal(callbacks, 0);
  await clock.advance(1);
  assert.equal(callbacks, 1);
});
