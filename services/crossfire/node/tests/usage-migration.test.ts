import { migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { schema15Store } from './support/schema15.js';
import { migrationCatalog, migrationChange, migrationQuery, migrationRows } from './support/migration-data.js';
test('schema 15 preserves every usage checkpoint and atomically admits unknown reasoning measurements', async () => {
  const database = schema15Store();
  try {
    const before = migrationRows(database, migrationQuery('runtime_usage_checkpoint')); await migrateFixture(database);
    assert.deepEqual(migrationRows(database, migrationQuery('runtime_usage_checkpoint')), before);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    migrationChange(database, migrationQuery('runtime_usage_checkpoint').insert({ agent_id: 'retained-agent', runtime: 'pi', session_id: 'pi-history',
      input: 100, cached_input: 20, cache_write_input: 0, output: 30, reasoning_output: null, total: 130, captured_at: 1 }));
    assert.equal(migrationRows(database, migrationQuery('runtime_usage_checkpoint').select('reasoning_output').where('runtime', 'pi'))[0]?.reasoning_output, null);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    await migrateFixture(database); assert.equal(migrationRows(database, migrationQuery('runtime_usage_checkpoint').count({ count: '*' }))[0]?.count, 2);
  } finally { database.close(); }
});
test('a failed usage conversion rolls back retained data, table definitions and schema version', async () => {
  const database = schema15Store();
  try {
    migrationChange(database, migrationQuery.schema.alterTable('principal', table => table.index(['created_at'], 'ix_runtime_usage_checkpoint_retention_next')));
    const schema = migrationCatalog(database), rows = migrationRows(database, migrationQuery('runtime_usage_checkpoint'));
    await assert.rejects(() => migrateFixture(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 15);
    assert.deepEqual(migrationRows(database, migrationQuery('runtime_usage_checkpoint')), rows);
    assert.deepEqual(migrationCatalog(database), schema);
  } finally { database.close(); }
});
