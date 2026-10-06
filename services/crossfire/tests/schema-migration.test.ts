import test from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createSchema, SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { schema12Store } from './support/schema12.js';
import type { Result } from '@ctlflow/crossfire-kernel/result';

function value<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }

function tables(database: Database.Database) {
  return (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
}
function snapshot(database: Database.Database) { return new Map(tables(database).map(table => [table, database.prepare('SELECT * FROM ' + table).all() as Record<string, unknown>[]])); }
function seed(database: Database.Database) {
  const repositories = createRepositories(database);
  value(repositories.principal.insert({ id: 'owner', matrixUserId: '@owner:test', kind: 'human', status: 'active', revision: 7, createdAt: 12 }));
  value(repositories.member.insert({ principalId: 'owner', principalKind: 'human', displayName: 'Private owner' }));
  value(repositories.principalRole.insert({ principalId: 'owner', principalKind: 'human', roleCode: 'administrator', assignedByMemberId: null, assignedAt: 12 }));
  for (const id of ['agent', 'unmanaged']) {
    value(repositories.principal.insert({ id, matrixUserId: '@' + id + ':test', kind: 'agent', status: 'active', revision: 9, createdAt: 12 }));
    value(repositories.agent.insert({ principalId: id, principalKind: 'agent', ownerId: 'owner', displayNameOverride: null, wakeMode: 'owner-agents' }));
    value(repositories.agentCredential.insert({ agentId: id, provisioningPassword: 'private-password-' + id, accessToken: 'private-token-' + id, updatedAt: 12 }));
    value(repositories.agentName.insert({ name: id, agentId: id, requestId: null, instanceKey: null }));
    value(repositories.principalRole.insert({ principalId: id, principalKind: 'agent', roleCode: 'agent', assignedByMemberId: 'owner', assignedAt: 12 }));
    value(repositories.principalApplication.insert({ principalId: id, appliedRevision: 9, appliedIntentHash: 'hash', appliedStatus: 'active', nativeDisplayName: id,
      lastAttemptAt: 12, lastSuccessAt: 12, nextCheckAt: 999, errorCode: null, errorMessage: null }));
  }
  database.exec(`
INSERT INTO enrollment_request(id,owner_id,fleet_key,controller_name,controller_credential_hash,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at)
 VALUES('direct','owner',NULL,NULL,NULL,'CODE00000000','private-claim','digest','approved',1,12,600,'owner',14);
INSERT INTO enrollment_item VALUES('direct','unmanaged','unmanaged','existing','unmanaged',NULL);
INSERT INTO enrollment_item_policy VALUES('direct','unmanaged','selected',9);
INSERT INTO enrollment_item_permission VALUES('direct','unmanaged','room.agent.invite','agent_room');
INSERT INTO enrollment_item_wake_sender VALUES('direct','unmanaged','owner');
INSERT INTO enrollment_controller_metadata VALUES('direct','private-label','retained metadata');
INSERT INTO enrollment_request(id,owner_id,fleet_key,controller_name,controller_credential_hash,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at)
 VALUES('pending-direct','owner',NULL,NULL,NULL,'CODE00000002','private-claim3','digest3','pending',0,12,600);
INSERT INTO enrollment_item VALUES('pending-direct','new','pending-name','claimed',NULL,NULL);
INSERT INTO agent_name VALUES('pending-name','pending-direct','new',NULL);
INSERT INTO enrollment_request(id,owner_id,fleet_key,controller_name,controller_credential_hash,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at)
 VALUES('incomplete-fleet','owner','incomplete','Controller','incomplete-hash','CODE00000003','private-claim4','digest4','pending',0,12,600);
INSERT INTO enrollment_item VALUES('incomplete-fleet','incomplete','incomplete-name','claimed',NULL,NULL);
INSERT INTO agent_name VALUES('incomplete-name','incomplete-fleet','incomplete',NULL);
INSERT INTO enrollment_request(id,owner_id,fleet_key,controller_name,controller_credential_hash,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at)
 VALUES('managed','owner','fleet','Computer','hash','CODE00000001','private-claim2','digest2','approved',1,12,600,'owner',14);
INSERT INTO enrollment_item VALUES('managed','agent','agent','existing','agent',NULL);
INSERT INTO enrollment_item_policy VALUES('managed','agent','owner-agents',9);
INSERT INTO fleet(id,owner_id,fleet_key,label,controller_name,revision,delivery_enabled,created_at,updated_at)
 VALUES('fleet','owner','fleet','Fleet','Computer',0,1,12,14);
INSERT INTO fleet_instance VALUES('owner','fleet','agent','agent');
INSERT INTO fleet_credential VALUES('managed','fleet','private-controller-hash',12,NULL);
INSERT INTO fleet_connection VALUES('fleet','connection','managed',14,999,NULL);
INSERT INTO listener_run(controller_bound,id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,stopped_at,disconnect_requested_at)
 VALUES(1,'run','agent','installed-release',12,14,2,10,NULL,NULL);
INSERT INTO listener_run(controller_bound,id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,stopped_at,disconnect_requested_at)
 VALUES(0,'direct-run','unmanaged','installed-release',12,14,2,10,NULL,NULL);
INSERT INTO runtime_observation VALUES('run','agent','exact-native-history',NULL,'codex','working',14,'shared',100000,NULL,14,1);
INSERT INTO runtime_setting VALUES('run','exact-native-history','model','configured-model','effective-model');
INSERT INTO runtime_decision VALUES('decision','agent','run','codex','exact-native-history','native-request','turn','item','question','Choose','Private question',1,NULL,14,'pending');
INSERT INTO instance_policy VALUES('instance',19,15,200,60,600,300,65536,1800,'Keep private configuration.','invitation','administrators');
INSERT INTO member_invitation(id,created_by_member_id,claim_hash,role_code,principal_kind,created_at,expires_at) VALUES('invitation','owner','private-hash','member','human',12,600);
`);
}

test('fresh schema is the single normalized controller target', () => {
  const database = openStore(':memory:');
  try {
    assert.equal(SCHEMA_VERSION, 13); assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(tables(database).length, 63);
    for (const name of ['ix_publication_storage', 'ix_listener_run_controller', 'ux_fleet_credential_binding', 'ix_enrollment_archive_item_agent',
      'ix_enrollment_archive_permission_code', 'ix_enrollment_archive_wake_sender_principal', 'ix_enrollment_archive_decider'])
      assert(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(name), name);
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally { database.close(); }
});

test('schema12 archives direct enrollment and stops unattributed runs without inventing controller authority', () => {
  const database = schema12Store();
  try {
    assert.equal(tables(database).length, 56); seed(database); const before = snapshot(database);
    createSchema(database);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    for (const [table, rows] of before) {
      const actual = database.prepare('SELECT * FROM ' + table).all();
      if (table === 'permission') assert.deepEqual(actual, rows.filter(row => !String(row.code).startsWith('agent.listener.disconnect.')));
      else if (table === 'role_permission') assert.deepEqual(actual, rows.filter(row => !String(row.permission_code).startsWith('agent.listener.disconnect.')));
      else if (table === 'enrollment_request') assert.deepEqual(actual, rows.filter(row => row.id === 'managed'));
      else if (['enrollment_item', 'enrollment_item_policy', 'enrollment_item_permission', 'enrollment_item_wake_sender'].includes(table))
        assert.deepEqual(actual, rows.filter(row => row.request_id === 'managed'));
      else if (table === 'enrollment_controller_metadata') assert.deepEqual(actual, []);
      else if (table === 'agent_name') assert.deepEqual(actual, rows.filter(row => row.agent_id !== null));
      else if (table === 'fleet') assert.deepEqual(actual, rows.map(row => ({ ...row, archived_at: null })));
      else if (table === 'fleet_instance') assert.deepEqual(actual, rows.map(row => ({ ...row, retired_at: null })));
      else if (table === 'listener_run') assert.deepEqual(actual, rows.map(({ controller_bound: _bound, ...row }) => ({
        controller_fleet_id: null, controller_connection_id: null, controller_credential_id: null, ...row, stopped_at: row.stopped_at ?? row.last_seen_at })));
      else assert.deepEqual(actual, rows, table);
    }
    assert.deepEqual(database.prepare('SELECT * FROM enrollment_archive').all(), before.get('enrollment_request')!.filter(row => row.id !== 'managed'));
    for (const [archived, original] of [['item', 'item'], ['policy', 'item_policy'], ['permission', 'item_permission'], ['wake_sender', 'item_wake_sender']]) {
      assert.deepEqual(database.prepare('SELECT * FROM enrollment_archive_' + archived).all(), before.get('enrollment_' + original)!.filter(row => row.request_id !== 'managed'));
      assert.throws(() => database.exec('DELETE FROM enrollment_archive_' + archived), /immutable/u);
      assert.throws(() => database.exec('UPDATE enrollment_archive_' + archived + " SET request_id='changed'"), /immutable/u);
    }
    assert.deepEqual(database.prepare('SELECT * FROM enrollment_archive_metadata').all(), before.get('enrollment_controller_metadata'));
    assert.throws(() => database.exec("UPDATE enrollment_archive SET status='rejected'"), /immutable/u);
    assert.throws(() => database.exec('DELETE FROM enrollment_archive_metadata'), /immutable/u);
    assert.throws(() => database.exec("INSERT INTO enrollment_archive_wake_sender VALUES('direct','unmanaged','missing')"), /FOREIGN KEY/u);
    assert.equal(value(createRepositories(database).fleetInstance.findByAgent('unmanaged')), null);
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.throws(() => database.exec("UPDATE listener_run SET stopped_at=NULL WHERE id='direct-run'"));
    const complete = snapshot(database); createSchema(database); assert.deepEqual(snapshot(database), complete);
  } finally { database.close(); }
});

test('failed conversion rolls back history, constraints, credentials and version atomically', () => {
  const database = schema12Store();
  try {
    seed(database); database.exec('CREATE INDEX ux_fleet_credential_binding ON principal(created_at);');
    const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 12);
    assert.deepEqual(snapshot(database), before); assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1); assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});

test('prototypes, foreign stores and future versions cannot bypass the only deployed migration', () => {
  for (const version of [...Array.from({ length: 11 }, (_, index) => index + 1), 14]) {
    const database = schema12Store();
    try {
      seed(database); database.pragma('user_version = ' + version);
      const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
      assert.throws(() => createSchema(database), /only deployed schema 12/u);
      assert.equal(database.pragma('user_version', { simple: true }), version); assert.deepEqual(snapshot(database), before);
      assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
      database.pragma('application_id = 99'); assert.throws(() => createSchema(database), /Unsupported/u);
    } finally { database.close(); }
  }
});
