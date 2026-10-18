import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { schema14Store as priorStore } from './support/deployed-migration.js';
import { migrationChange, migrationQuery, migrationRows } from './support/migration-data.js';

const relations = [['enrollment_request','enrollment_archive','id'], ['enrollment_item','enrollment_archive_item','request_id'],
  ['enrollment_item_policy','enrollment_archive_policy','request_id'], ['enrollment_item_permission','enrollment_archive_permission','request_id'],
  ['enrollment_item_wake_sender','enrollment_archive_wake_sender','request_id'], ['enrollment_controller_metadata','enrollment_archive_metadata','enrollment_id']] as const;

test('schema 14 partial rosters become exact immutable history without a runtime partial-admission path', async () => {
  const database = priorStore();
  try {
    const originals = relations.map(([table,,key]) => migrationRows(database, migrationQuery(table).whereIn(key, ['partial', 'pending'])
      .orderBy([key, table === 'enrollment_request' ? 'owner_id' : table === 'enrollment_controller_metadata' ? 'key' : 'instance_key'])));
    const protectedTables = ['principal','agent_credential','fleet','fleet_instance','fleet_credential'];
    const protectedRows = protectedTables.map(table => migrationRows(database, migrationQuery(table)));
    const current = migrationRows(database, migrationQuery('enrollment_item').select('request_id', 'instance_key', 'requested_name', 'outcome', 'agent_id').where('request_id', 'current'));
    await migrateFixture(database);
    for (const [index,[source,target,key]] of relations.entries()) {
      assert.deepEqual(migrationRows(database, migrationQuery(target).orderBy([key, target === 'enrollment_archive' ? 'owner_id' : target === 'enrollment_archive_metadata' ? 'key' : 'instance_key'])), originals[index], target);
      assert.deepEqual(migrationRows(database, migrationQuery(source).whereIn(key, ['partial', 'pending'])), [], source);
      assert.throws(() => migrationChange(database, migrationQuery(target).update({ [key]: migrationQuery.ref(key) })), /immutable/u);
    }
    for (const [index,table] of protectedTables.entries()) assert.deepEqual(migrationRows(database, migrationQuery(table)), protectedRows[index], table);
    assert.deepEqual(migrationRows(database, migrationQuery('enrollment_item')), current);
    assert.deepEqual(migrationRows(database, migrationQuery('agent_name').select('name').orderBy('name')), [{ name:'exact' },{ name:'saved' }]);
    assert.throws(() => migrationChange(database, migrationQuery('enrollment_item').insert({ request_id: 'current', instance_key: 'invalid', requested_name: 'invalid', outcome: 'failed', agent_id: null })), /CHECK/u);
    assert.throws(() => migrationRows(database, migrationQuery('enrollment_item').select('failure_code')), /no such column/u);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
    assert.equal(sqliteMetadata.integrityResult(database), 'ok');
    assert.equal(sqliteMetadata.foreignKeys(database), 1);
    await migrateFixture(database);
    assert.equal(migrationRows(database, migrationQuery('enrollment_archive').count({ count: '*' }))[0]?.count, 2);
  } finally { database.close(); }
});

test('a partial-roster archival conflict rolls back the complete name and enrollment conversion', async () => {
  const database = priorStore();
  try {
    migrationChange(database, migrationQuery('agent').update({ display_name_override: 'Retired caption' }));
    migrationChange(database, migrationQuery('enrollment_archive').insert(migrationQuery('enrollment_request')
      .select('controller_name', 'controller_credential_hash', 'fleet_key', 'id', 'owner_id', 'verification_code', 'claim_hash', 'roster_digest',
        'status', 'revision', 'created_at', 'expires_at', 'decided_by_member_id', 'decided_at').where('id', 'partial')));
    const before = database.serialize();
    await assert.rejects(() => migrateFixture(database), /UNIQUE/u);
    assert.deepEqual(database.serialize(), before);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, 14);
    assert.equal(sqliteMetadata.foreignKeys(database), 1);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});
