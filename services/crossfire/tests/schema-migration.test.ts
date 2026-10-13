import test from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createSchema, SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { loggingSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/logging';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { enrollmentRosterValue } from '@ctlflow/crossfire-domain/enrollment/roster-digest';
import { schema13Store, schema13Tables } from './support/schema13.js';
import DatabaseConstructor from 'better-sqlite3';
import { restoreSchema16Logging } from './support/schema16.js';

function snapshot(database: Database.Database) {
  const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return new Map(tables.map(({ name }) => [name, database.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all() as Record<string, unknown>[]]));
}
function seed(database: Database.Database) {
  database.exec(`
INSERT INTO principal VALUES('owner','@owner:test','human','active',7,12),('other','@other:test','human','active',0,12);
INSERT INTO member VALUES('owner','human','Private owner'),('other','human','Other');
INSERT INTO enrollment_request(controller_name,controller_credential_hash,fleet_key,id,owner_id,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at)
 VALUES('Computer','private-controller-hash','fleet','request','owner','CODE00000000','private-claim','digest','pending',0,12,600,NULL,NULL);
INSERT INTO enrollment_archive VALUES(NULL,NULL,NULL,'archive','owner','CODE00000001','archived-claim','retained-historical-digest','approved',1,12,600,'owner',14);
`);
  for (const mode of ['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected']) {
    const agentId = 'agent-' + mode;
    database.prepare('INSERT INTO principal VALUES(?,?,\'agent\',\'active\',9,12)').run(agentId, '@' + agentId + ':test');
    database.prepare('INSERT INTO agent VALUES(?,\'agent\',\'owner\',NULL,?)').run(agentId, mode);
    database.prepare('INSERT INTO agent_credential VALUES(?,?,?,12)').run(agentId, 'private-password-' + mode, 'private-token-' + mode);
    database.prepare('INSERT INTO agent_name VALUES(?,NULL,NULL,?)').run(mode, agentId);
    database.prepare('INSERT INTO enrollment_item VALUES(?,?,?,\'existing\',?,NULL)').run('request', mode, mode, agentId);
    database.prepare('INSERT INTO enrollment_item_policy VALUES(?,?,?,9)').run('request', mode, mode);
    database.prepare('INSERT INTO enrollment_archive_item VALUES(?,?,?,\'existing\',?,NULL)').run('archive', mode, mode, agentId);
    database.prepare('INSERT INTO enrollment_archive_policy VALUES(?,?,?,9)').run('archive', mode, mode);
    if (mode === 'selected') {
      database.prepare('INSERT INTO agent_wake_sender VALUES(?,?)').run(agentId, 'other');
      for (const prefix of ['item', 'archive']) database.prepare('INSERT INTO enrollment_' + prefix + '_wake_sender VALUES(?,?,?)').run(prefix === 'item' ? 'request' : 'archive', mode, 'other');
    }
  }
  database.exec(`
INSERT INTO fleet(id,owner_id,fleet_key,label,controller_name,archived_at,delivery_enabled,revision,created_at,updated_at)
 VALUES('fleet','owner','fleet','Private fleet','Computer',NULL,1,4,12,12);
INSERT INTO fleet_instance(owner_id,fleet_key,instance_key,agent_id,retired_at) VALUES('owner','fleet','selected','agent-selected',NULL);
INSERT INTO agent_room_grant VALUES('agent-selected','!matter:test','generation','owner','owner',NULL,'managed','reply',NULL,0,3,1,12);
INSERT INTO agent_room_permission VALUES('agent-selected','!matter:test','generation','room.agent.invite','agent_room','owner',12);
INSERT INTO enrollment_item_permission VALUES('request','selected','room.agent.invite','agent_room');
INSERT INTO enrollment_archive_permission VALUES('archive','selected','room.agent.invite','agent_room');
INSERT INTO enrollment_controller_metadata VALUES('request','zone','local');
`);
}

test('schema 13 advances atomically with exact wake semantics and protected history, credentials and room grants', () => {
  const database = schema13Store();
  try {
    seed(database);
    const before = snapshot(database), schema = database.prepare('SELECT name FROM sqlite_schema ORDER BY name').all();
    createSchema(database);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
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
    assert.deepEqual(database.prepare('SELECT * FROM agent_wake_sender ORDER BY agent_id').all(), expected);
    for (const prefix of ['item', 'archive']) {
      const requestId = prefix === 'item' ? 'request' : 'archive';
      assert.deepEqual(database.prepare('SELECT * FROM enrollment_' + prefix + '_wake_sender ORDER BY instance_key').all(),
        expected.map(entry => ({ request_id: requestId, instance_key: entry.agent_id.slice(6), sender_principal_id: entry.sender_principal_id, include_agents: entry.include_agents })));
      for (const policy of after.get('enrollment_' + prefix + '_policy')!) assert.equal(policy.wake_mode,
        ['humans', 'everyone'].includes(String(policy.instance_key)) ? policy.instance_key : 'selected');
    }
    const policies = createRepositories(database).fleetPolicy.requested('request'); assert(policies.ok);
    const digest = createHash('sha256').update(enrollmentRosterValue({ ownerMatrixId: '@owner:test', fleetKey: 'fleet', controller: { name: 'Computer', metadata: { zone: 'local' } },
      instances: policies.value.map(policy => ({ instanceKey: policy.instanceKey, name: policy.instanceKey, agentId: 'agent-' + policy.instanceKey,
        coordinationPolicy: { wakeMode: policy.wakeMode, senders: policy.matrixSenders, permissions: policy.permissions } })) })).digest('hex');
    assert.deepEqual(after.get('enrollment_request'), before.get('enrollment_request')!.map(row => ({ ...row, roster_digest: digest })));
    assert.throws(() => database.exec("UPDATE enrollment_archive_policy SET wake_mode='everyone'"), /immutable/u);
    database.exec('DELETE FROM enrollment_archive_wake_sender');
    assert.equal(snapshot(database).get('enrollment_archive_wake_sender')!.length, 0);
    assert.throws(() => database.exec("UPDATE agent SET wake_mode='owner'"), /CHECK/u);
    assert.throws(() => database.exec("UPDATE agent_wake_sender SET include_agents=2"), /CHECK/u);
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(database.prepare('SELECT name FROM sqlite_schema ORDER BY name').all().length,
      schema.length + [...loggingSchema.matchAll(/CREATE INDEX /gu)].length - 6);
    const complete = snapshot(database); createSchema(database); assert.deepEqual(snapshot(database), complete);
  } finally { database.close(); }
});

test('a failed forward conversion rolls back every table, guard, credential and version', () => {
  const database = schema13Store();
  try {
    seed(database); database.exec('CREATE INDEX ix_agent_owner_next ON principal(created_at)');
    const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 13);
    assert.deepEqual(snapshot(database), before); assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1); assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});

test('schema 16 logging migration preserves every row, matches a fresh schema and cannot partially remove archive guards', () => {
  const database = new DatabaseConstructor(':memory:'), fresh = new DatabaseConstructor(':memory:');
  try {
    createSchema(database); restoreSchema16Logging(database); createSchema(fresh);
    const before = snapshot(database);
    database.exec('CREATE INDEX ix_listener_run_retention ON listener_run(last_seen_at,id)');
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 16);
    assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'protect_enrollment_archive%_delete'").all().length, 6);
    database.exec('DROP INDEX ix_listener_run_retention'); createSchema(database);
    assert.deepEqual(snapshot(database), before);
    const metadata = (store: DatabaseConstructor.Database) => store.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    assert.deepEqual(metadata(database), metadata(fresh)); assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  } finally { fresh.close(); database.close(); }
});

test('only the verified deployed schema can migrate; prototypes, foreign stores and future versions remain unchanged', () => {
  for (const version of [...Array.from({ length: 12 }, (_, index) => index + 1), SCHEMA_VERSION + 1]) {
    const database = schema13Store();
    try {
      seed(database); database.pragma('user_version = ' + version);
      const before = snapshot(database), schema = database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
      assert.throws(() => createSchema(database), /only deployed schemas 13, 14, 15 and 16/u);
      assert.equal(database.pragma('user_version', { simple: true }), version); assert.deepEqual(snapshot(database), before);
      assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
      database.pragma('application_id = 99'); assert.throws(() => createSchema(database), /Unsupported/u);
    } finally { database.close(); }
  }
});
