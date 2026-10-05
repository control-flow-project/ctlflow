import assert from 'node:assert/strict';
import test from 'node:test';
import { sleepDurationSeconds } from '../apps/web/src/sleep-duration.js';

test('management idle minutes convert to exact seconds without accepting empty, negative or overflowing values', () => {
  const maximum = 86400;
  for (const [input, expected] of [['30', 1800], ['0', 0], ['0.5', 30], ['30.5', 1830], ['1440', maximum], [' 15 ', 900]] as const) {
    assert.deepEqual(sleepDurationSeconds(input, maximum), { ok: true, value: expected }, input);
  }
  for (const input of ['', ' ', '-1', '-0', 'NaN', 'Infinity', '1e2', '1441', '0.001', '0.0000000001', '9007199254740991']) {
    assert.equal(sleepDurationSeconds(input, maximum).ok, false, input);
  }
  for (const seconds of [1, 2, 59, 61, 3599, 86399]) {
    assert.deepEqual(sleepDurationSeconds(String(seconds / 60), maximum), { ok: true, value: seconds }, 'Persisted second precision ' + seconds);
  }
});
