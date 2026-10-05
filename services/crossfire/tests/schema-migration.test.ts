import test from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createSchema, SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { schema11Store } from './support/schema11.js';
import { value } from './support/application.js';

function tables(database: Database.Database) {
  return (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
}
function snapshot(database: Database.Database) { return new Map(tables(database).map(table => [table, database.prepare('SELECT * FROM ' + table).all()])); }
function seed(database: Database.Database) {
  const repositories = createRepositories(database);
  value(repositories.principal.insert({ id: 'owner', matrixUserId: '@owner:test', kind: 'human', status: 'active', revision: 7, createdAt: 12 }));
  value(repositories.member.insert({ principalId: 'owner', principalKind: 'human', displayName: 'Private owner' }));
  value(repositories.principalRole.insert({ principalId: 'owner', principalKind: 'human', roleCode: 'administrator', assignedByMemberId: null, assignedAt: 12 }));
  value(repositories.principal.insert({ id: 'agent', matrixUserId: '@agent:test', kind: 'agent', status: 'active', revision: 9, createdAt: 12 }));
  value(repositories.agent.insert({ principalId: 'agent', principalKind: 'agent', ownerId: 'owner', displayNameOverride: null, wakeMode: 'owner-agents' }));
  value(repositories.agentCredential.insert({ agentId: 'agent', provisioningPassword: 'private-password', accessToken: 'private-token', updatedAt: 12 }));
  value(repositories.listenerRun.insert({ id: 'run', agentId: 'agent', release: 'installed-release', startedAt: 12, lastSeenAt: 14, activeMs: 2,
    messagesDelivered: 10, controllerBound: true, stoppedAt: null, disconnectRequestedAt: null }));
  database.exec("INSERT INTO runtime_observation VALUES('run','agent','exact-native-history',NULL,'codex','working',14,'shared',100000,NULL); INSERT INTO runtime_setting VALUES('run','exact-native-history','model','configured-model','effective-model');");
  database.exec("INSERT INTO instance_policy VALUES('instance',19,15,200,60,600,300,65536,'Keep private configuration.','invitation','administrators');");
  database.exec("INSERT INTO member_invitation(id,created_by_member_id,claim_hash,role_code,principal_kind,created_at,expires_at) VALUES('invitation','owner','private-hash','member','human',12,600);");
}

test('fresh schema is the one current target with indexed normalized publication and runtime state', () => {
  const database = openStore(':memory:');
  try {
    assert.equal(SCHEMA_VERSION, 12); assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(tables(database).length, 56);
    for (const name of ['ix_publication_storage', 'ix_publication_cleanup', 'ix_publication_file_manifest', 'ix_runtime_observation_run_state'])
      assert(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(name), name);
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally { database.close(); }
});

test('deployed schema 11 converts once while preserving every row, native history and credential', () => {
  const database = schema11Store();
  try {
    assert.equal(tables(database).length, 54); seed(database); const before = snapshot(database);
    createSchema(database);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    for (const [table, rows] of before) {
      const actual = database.prepare('SELECT * FROM ' + table).all();
      if (table === 'permission' || table === 'role_permission') for (const row of rows) assert(actual.some(value => JSON.stringify(value) === JSON.stringify(row)), table);
      else if (table === 'instance_policy') assert.deepEqual(actual, (rows as Record<string, unknown>[]).map(row => ({ ...row, fleet_idle_timeout_seconds: 1800 })));
      else if (table === 'runtime_observation') assert.deepEqual(actual, (rows as Record<string, unknown>[]).map(row => ({ ...row, last_activity_at: null, history_available: null })));
      else assert.deepEqual(actual, rows, table);
    }
    assert.equal(value(createRepositories(database).instancePolicy.find({ id: 'instance' }))!.fleetIdleTimeoutSeconds, 1800);
    assert.equal((database.prepare("SELECT count(*) AS count FROM permission WHERE code LIKE 'publication.%'").get() as { count: number }).count, 5);
    database.exec("UPDATE runtime_observation SET state='sleeping',last_activity_at=14,history_available=1;");
    assert.throws(() => database.exec('UPDATE runtime_observation SET history_available=2;'));
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    const complete = snapshot(database); createSchema(database); assert.deepEqual(snapshot(database), complete);
  } finally { database.close(); }
});

test('failed forward conversion rolls back new tables, columns, references and version atomically', () => {
  const database = schema11Store();
  try {
    seed(database); database.exec('CREATE INDEX ix_publication_created ON principal(created_at);');
    const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 11);
    assert.deepEqual(snapshot(database), before); assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});

test('historical prototypes, foreign stores and future versions are rejected without modifying data', () => {
  for (const version of [...Array.from({ length: 10 }, (_, index) => index + 1), 13]) {
    const database = schema11Store();
    try {
      seed(database); database.pragma('user_version = ' + version);
      const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
      assert.throws(() => createSchema(database), /only deployed schema 11/u);
      assert.equal(database.pragma('user_version', { simple: true }), version); assert.deepEqual(snapshot(database), before);
      assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
      database.pragma('application_id = 99'); assert.throws(() => createSchema(database), /Unsupported/u);
    } finally { database.close(); }
  }
});
