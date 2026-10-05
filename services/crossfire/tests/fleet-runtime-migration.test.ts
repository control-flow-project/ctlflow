import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '@crossfire/adapter-sqlite/open-store';

test('current fleet session commands retain normalized indexed lifecycle state', () => {
  const database = openStore(':memory:');
  try {
    assert.deepEqual(database.prepare('SELECT * FROM fleet_runtime_operation').all(), []);
    for (const index of ['uq_fleet_runtime_operation_active', 'ix_fleet_runtime_operation_created', 'ix_fleet_runtime_operation_agent', 'ix_fleet_runtime_operation_author', 'ix_fleet_runtime_operation_credential'])
      assert(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(index), index);
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally { database.close(); }
});
