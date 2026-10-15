import { migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { schema15Store } from './support/schema15.js';
test('schema 15 preserves every usage checkpoint and atomically admits unknown reasoning measurements', async () => {
  const database = schema15Store();
  try {
    const before = database.prepare('SELECT * FROM runtime_usage_checkpoint').all(); await migrateFixture(database);
    assert.deepEqual(database.prepare('SELECT * FROM runtime_usage_checkpoint').all(), before);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    database.exec("INSERT INTO runtime_usage_checkpoint VALUES('retained-agent','pi','pi-history',100,20,0,30,NULL,130,1)");
    assert.equal(database.prepare<[], { reasoning_output: number | null }>("SELECT reasoning_output FROM runtime_usage_checkpoint WHERE runtime='pi'").get()?.reasoning_output, null);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    await migrateFixture(database); assert.equal(database.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM runtime_usage_checkpoint').get()?.count, 2);
  } finally { database.close(); }
});
test('a failed usage conversion rolls back retained data, table definitions and schema version', async () => {
  const database = schema15Store();
  try {
    database.exec('CREATE INDEX ix_runtime_usage_checkpoint_retention_next ON principal(created_at)');
    const schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), rows = database.prepare('SELECT * FROM runtime_usage_checkpoint').all();
    await assert.rejects(() => migrateFixture(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 15);
    assert.deepEqual(database.prepare('SELECT * FROM runtime_usage_checkpoint').all(), rows);
    assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
  } finally { database.close(); }
});
