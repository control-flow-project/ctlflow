import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrateFixture, loggingSchema } from './support/storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { enrollmentRosterValue } from '@ctlflow/crossfire-domain/enrollment/roster-digest';
import { schema13Store, schema13Tables } from './support/schema13.js';
import DatabaseConstructor from 'better-sqlite3';
import { restoreSchema16Logging } from './support/schema16.js';
import { seedWakeHistory as seed } from './support/deployed-migration.js';
import { migrationCatalog, migrationChange, migrationQuery, migrationRows, migrationSnapshot as snapshot } from './support/migration-data.js';
test('schema 13 advances atomically with exact wake semantics and protected history, credentials and room grants', async () => {
  const database = schema13Store();
  try {
    seed(database);
    const before = snapshot(database), schema = migrationCatalog(database);
    await migrateFixture(database);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, SCHEMA_VERSION);
    const after = snapshot(database), converted = new Set([...schema13Tables, 'enrollment_request']);
    for (const [table, rows] of before) if (!converted.has(table)) {
      const expected = table === 'enrollment_item' ? rows.map(({ failure_code, ...row }) => {
        assert.equal(failure_code, null); return row;
      }) : rows;
      assert.deepEqual(after.get(table), expected, table);
    }
    for (const entry of after.get('agent')!) assert.equal(entry.wake_mode, ['agent-humans', 'agent-everyone'].includes(String(entry.principal_id)) ? String(entry.principal_id).slice(6) : 'selected');
    const expected = ['owner', 'owner-agents', 'humans', 'selected'].map(mode => ({
      agent_id: 'agent-' + mode, sender_principal_id: mode === 'selected' ? 'other' : 'owner', include_agents: mode === 'owner' || mode === 'selected' ? 0 : 1,
    })).sort((left, right) => left.agent_id.localeCompare(right.agent_id));
    assert.deepEqual(migrationRows(database, migrationQuery('agent_wake_sender').orderBy('agent_id')), expected);
    for (const prefix of ['item', 'archive']) {
      const requestId = prefix === 'item' ? 'request' : 'archive';
      assert.deepEqual(migrationRows(database, migrationQuery('enrollment_' + prefix + '_wake_sender').orderBy('instance_key')),
        expected.map(entry => ({ request_id: requestId, instance_key: entry.agent_id.slice(6), sender_principal_id: entry.sender_principal_id, include_agents: entry.include_agents })));
      for (const policy of after.get('enrollment_' + prefix + '_policy')!) assert.equal(policy.wake_mode,
        ['humans', 'everyone'].includes(String(policy.instance_key)) ? policy.instance_key : 'selected');
    }
    const policies = createRepositories(database).fleetPolicy.requested('request'); assert(policies.ok);
    const digest = createHash('sha256').update(enrollmentRosterValue({ ownerMatrixId: '@owner:test', fleetKey: 'fleet', controller: { name: 'Computer', metadata: { zone: 'local' } },
      instances: policies.value.map(policy => ({ instanceKey: policy.instanceKey, name: policy.instanceKey, agentId: 'agent-' + policy.instanceKey,
        coordinationPolicy: { wakeMode: policy.wakeMode, senders: policy.matrixSenders, permissions: policy.permissions } })) })).digest('hex');
    assert.deepEqual(after.get('enrollment_request'), before.get('enrollment_request')!.map(row => ({ ...row, roster_digest: digest })));
    assert.throws(() => migrationChange(database, migrationQuery('enrollment_archive_policy').update({ wake_mode: 'everyone' })), /immutable/u);
    migrationChange(database, migrationQuery('enrollment_archive_wake_sender').delete());
    assert.equal(snapshot(database).get('enrollment_archive_wake_sender')!.length, 0);
    assert.throws(() => migrationChange(database, migrationQuery('agent').update({ wake_mode: 'owner' })), /CHECK/u);
    assert.throws(() => migrationChange(database, migrationQuery('agent_wake_sender').update({ include_agents: 2 })), /CHECK/u);
    assert.equal(sqliteMetadata.foreignKeys(database), 1);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
    assert.equal(sqliteMetadata.integrityResult(database), 'ok');
    assert.equal(migrationCatalog(database).length,
      schema.length + [...loggingSchema.matchAll(/CREATE INDEX /gu)].length + 1 - 6,
      'Forward migrations add the totals/logging indexes and remove exactly six obsolete archive delete guards');
    const complete = snapshot(database); await migrateFixture(database); assert.deepEqual(snapshot(database), complete);
  } finally { database.close(); }
});

test('a failed forward conversion rolls back every table, guard, credential and version', async () => {
  const database = schema13Store();
  try {
    seed(database); migrationChange(database, migrationQuery.schema.alterTable('principal', table => table.index(['created_at'], 'ix_agent_owner_next')));
    const before = snapshot(database), schema = migrationCatalog(database);
    await assert.rejects(() => migrateFixture(database), /already exists/u);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, 13);
    assert.deepEqual(snapshot(database), before); assert.deepEqual(migrationCatalog(database), schema);
    assert.equal(sqliteMetadata.foreignKeys(database), 1); assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});

test('schema 16 logging migration preserves every row, matches a fresh schema and cannot partially remove archive guards', async () => {
  const database = new DatabaseConstructor(':memory:'), fresh = new DatabaseConstructor(':memory:');
  try {
    await migrateFixture(database); restoreSchema16Logging(database); await migrateFixture(fresh);
    const before = snapshot(database);
    migrationChange(database, migrationQuery.schema.alterTable('listener_run', table => table.index(['last_seen_at', 'id'], 'ix_listener_run_retention')));
    await assert.rejects(() => migrateFixture(database), /already exists/u);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, 16);
    assert.equal(migrationRows(database, migrationQuery('sqlite_schema').select('name').where('type', 'trigger').whereLike('name', 'protect_enrollment_archive%_delete')).length, 6);
    migrationChange(database, migrationQuery.schema.alterTable('listener_run', table => table.dropIndex([], 'ix_listener_run_retention'))); await migrateFixture(database);
    assert.deepEqual(snapshot(database), before);
    const metadata = (store: DatabaseConstructor.Database) => migrationRows(store, migrationQuery('sqlite_schema').select('type', 'name', 'tbl_name', 'sql').where('name', 'not like', 'sqlite_%').orderBy(['type', 'name']));
    assert.deepEqual(metadata(database), metadata(fresh)); assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, SCHEMA_VERSION);
  } finally { fresh.close(); database.close(); }
});

test('only the verified deployed schema can migrate; prototypes, foreign stores and future versions remain unchanged', async () => {
  for (const version of [...Array.from({ length: 12 }, (_, index) => index + 1), SCHEMA_VERSION + 1]) {
    const database = schema13Store();
    try {
      seed(database); database.pragma('user_version = ' + version);
      const before = snapshot(database), schema = migrationCatalog(database);
      await assert.rejects(() => migrateFixture(database), /only deployed schemas 13 through 18/u);
      assert.equal(sqliteMetadata.databaseIdentity(database).version, version); assert.deepEqual(snapshot(database), before);
      assert.deepEqual(migrationCatalog(database), schema);
      database.pragma('application_id = 99'); await assert.rejects(() => migrateFixture(database), /Unsupported/u);
    } finally { database.close(); }
  }
});
