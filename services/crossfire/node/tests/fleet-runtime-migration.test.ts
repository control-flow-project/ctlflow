import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

test('current fleet session commands retain normalized indexed lifecycle state', () => {
  const database = openTestStore(':memory:');
  try {
    assert.deepEqual(executeSelect(database, schema, query => query.from('fleet_runtime_operation')), []);
    for (const index of ['uq_fleet_runtime_operation_active', 'ix_fleet_runtime_operation_created', 'ix_fleet_runtime_operation_agent', 'ix_fleet_runtime_operation_author', 'ix_fleet_runtime_operation_credential'])
      assert(executeSelect(database, metadataSchema, (query, params) => query.from('sqlite_schema').where(row => row.type === 'index' && row.name === params.name).any(), { name: index }), index);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []); assert.equal(sqliteMetadata.integrityResult(database), 'ok');
  } finally { database.close(); }
});
