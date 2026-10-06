import assert from 'node:assert/strict';
import test from 'node:test';
import { dockerResourceProperties } from './docker-test-resources.mjs';

test('Docker verification carries finite aggregate memory, swap and task budgets into its exact slice', () => {
  assert.deepEqual(dockerResourceProperties({ 'memory.max': '8589934592', 'memory.swap.max': '0', 'pids.max': '1024' }),
    ['MemoryMax', 't', '8589934592', 'MemorySwapMax', 't', '0', 'TasksMax', 't', '1024']);
});

test('Docker verification rejects missing, unlimited, negative and zero memory/task budgets', () => {
  for (const key of ['memory.max', 'memory.swap.max', 'pids.max']) {
    for (const value of [undefined, 1, 'max', '-1', '1.5', ...(key === 'memory.swap.max' ? [] : ['0'])]) {
      assert.throws(() => dockerResourceProperties({ 'memory.max': '8589934592', 'memory.swap.max': '0', 'pids.max': '1024', [key]: value }), /finite/u);
    }
  }
});
