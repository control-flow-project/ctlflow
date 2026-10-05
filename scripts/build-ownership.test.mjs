import assert from 'node:assert/strict';
import test from 'node:test';
import { productBuildClosure } from './build.mjs';

test('product builds include declared public executable consumers and their exact runtime closure', () => {
  assert.deepEqual(productBuildClosure(['crossfire']), ['crossfire', 'fleetd', 'fleet']);
  assert.deepEqual(productBuildClosure(['fleet']), ['fleetd', 'fleet']);
  assert.deepEqual(productBuildClosure(['fleetd']), ['fleetd']);
  assert.throws(() => productBuildClosure([]));
  assert.throws(() => productBuildClosure(['unknown']));
});
