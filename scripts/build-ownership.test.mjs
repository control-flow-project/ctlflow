import assert from 'node:assert/strict';
import test from 'node:test';
import { productBuildClosure } from './build.mjs';

test('product builds include declared build dependencies without a Node service runtime', () => {
  assert.deepEqual(productBuildClosure(['crossfire']), ['crossfire']);
  assert.deepEqual(productBuildClosure(['fleet']), ['fleet']);
  assert.deepEqual(productBuildClosure(['fleetd']), ['fleetd']);
  assert.throws(() => productBuildClosure([]));
  assert.throws(() => productBuildClosure(['unknown']));
});
