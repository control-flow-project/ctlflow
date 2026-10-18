import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { agentChange } from '@ctlflow/crossfire-contracts/schema/request';
import { restoreSchema14EnrollmentItems } from './support/schema14.js';
import { restoreSchema16Logging } from './support/schema16.js';
import { migrationChange, migrationQuery, migrationRows } from './support/migration-data.js';

test('schema 14 preserves identity and private state while retiring independent labels into audit', async () => {
  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys=ON'); await migrateFixture(database);
    restoreSchema14EnrollmentItems(database);
    restoreSchema16Logging(database);
    migrationChange(database, migrationQuery.schema.alterTable('agent', table => table.text('display_name_override')));
    migrationChange(database, migrationQuery('principal').insert([
      { id: 'owner', matrix_user_id: '@owner:test', kind: 'human', status: 'active', revision: 4, created_at: 1 },
      { id: 'agent', matrix_user_id: '@agent:test', kind: 'agent', status: 'active', revision: 7, created_at: 1 },
    ]));
    migrationChange(database, migrationQuery('member').insert({ principal_id: 'owner', principal_kind: 'human', display_name: 'Owner' }));
    migrationChange(database, migrationQuery('agent').insert({ principal_id: 'agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected', display_name_override: 'Ambiguous caption' }));
    migrationChange(database, migrationQuery('agent_name').insert({ name: 'registered', request_id: null, instance_key: null, agent_id: 'agent' }));
    migrationChange(database, migrationQuery('agent_credential').insert({ agent_id: 'agent', provisioning_password: 'private-password', access_token: 'private-token', updated_at: 1 }));
    database.pragma('user_version=14');
    const identities = migrationRows(database, migrationQuery('principal').orderBy('id'));
    const credentials = migrationRows(database, migrationQuery('agent_credential'));
    await migrateFixture(database);
    assert.equal(sqliteMetadata.databaseIdentity(database).version, SCHEMA_VERSION);
    assert.deepEqual(migrationRows(database, migrationQuery('principal').orderBy('id')), identities);
    assert.deepEqual(migrationRows(database, migrationQuery('agent_credential')), credentials);
    assert.deepEqual(migrationRows(database, migrationQuery('agent_name').select('name', 'agent_id')), [{ name: 'registered', agent_id: 'agent' }]);
    assert.deepEqual(migrationRows(database, migrationQuery('agent')), [{ principal_id: 'agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected' }]);
    assert.deepEqual(migrationRows(database, migrationQuery('audit_event').select('target_id', 'action', 'message')),
      [{ target_id: 'agent', action: 'agent.name.canonicalized', message: '{"retiredDisplayName":"Ambiguous caption"}' }]);
    assert.throws(() => migrationChange(database, migrationQuery('agent').update({ display_name_override: 'registered' })), /no such column/u);
    await migrateFixture(database); assert.equal(migrationRows(database, migrationQuery('audit_event').count({ count: '*' }))[0]?.count, 1);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
    assert.equal(sqliteMetadata.integrityResult(database), 'ok');
    assert.equal(agentChange({ expectedRevision: 7, displayName: 'Another caption' }).ok, false);
  } finally { database.close(); }
});
