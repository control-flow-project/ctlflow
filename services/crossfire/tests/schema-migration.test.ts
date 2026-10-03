import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { value } from './support/application.js';

function previousDatabase(version: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1) {
  mkdirSync('.temp', { recursive: true });
  const file = join(mkdtempSync(join(process.cwd(), '.temp/policy-migration-')), 'management.sqlite');
  const database = openStore(file), repositories = createRepositories(database);
  value(repositories.principal.insert({ id: 'owner', matrixUserId: '@owner:test', kind: 'human', status: 'active', revision: 7, createdAt: 12 }));
  value(repositories.member.insert({ principalId: 'owner', principalKind: 'human', displayName: 'Private owner' }));
  value(repositories.principalRole.insert({ principalId: 'owner', principalKind: 'human', roleCode: 'administrator', assignedByMemberId: null, assignedAt: 12 }));
  value(repositories.instancePolicy.insert({ id: 'instance', revision: 19, maxOwnerAgents: 15, maxAgents: 200, maxPending: 60,
    enrollmentSeconds: 600, reconcileSeconds: 300, agentInstructions: 'Keep private configuration.', signupMode: 'invitation', invitationIssuers: 'administrators' }));
  database.exec("INSERT INTO member_invitation(id, created_by_member_id, claim_hash, role_code, principal_kind, created_at, expires_at) VALUES('invitation', 'owner', 'private-hash', 'member', 'human', 12, 600);");
  database.exec("INSERT INTO audit_event(id, request_id, actor_kind, actor_principal_id, owner_id, target_kind, target_id, action, outcome, message, created_at) VALUES('audit', 'request', 'human', 'owner', 'owner', 'member', 'owner', 'member.change', 'accepted', '', 12);");
  const before = { principal: database.prepare('SELECT * FROM principal').all(), invitation: database.prepare('SELECT * FROM member_invitation').all(), audit: database.prepare('SELECT * FROM audit_event').all() };
  database.exec('DROP TRIGGER protect_management_conversation_grant_insert; DROP TRIGGER protect_management_conversation_grant_update; DROP TRIGGER protect_management_conversation_permission_insert; DROP TRIGGER protect_management_conversation_permission_update; DROP TRIGGER protect_management_conversation_owner_insert; DROP TRIGGER protect_management_conversation_owner_update;');
  database.exec('DROP TABLE runtime_setting; DROP TABLE runtime_observation; DROP TABLE runtime_decision_answer; DROP TABLE runtime_decision_option; DROP TABLE runtime_decision_question; DROP TABLE runtime_decision; DROP TABLE incident_notification; DROP TABLE runtime_incident; DROP TABLE management_conversation; DROP INDEX ux_listener_run_agent_binding; DROP INDEX ix_listener_run_agent_started;');
  database.exec("DELETE FROM role_permission WHERE permission_code LIKE 'runtime.%'; DELETE FROM permission WHERE code LIKE 'runtime.%';");
  if (version < 7) database.exec('DROP TRIGGER protect_owner_conversation_participant_insert; DROP TRIGGER protect_owner_conversation_participant_update;');
  if (version < 6) database.exec("DROP TRIGGER protect_owner_conversation_permission_insert; DROP TRIGGER protect_owner_conversation_permission_update; DROP TRIGGER protect_owner_conversation; DROP TRIGGER validate_owner_conversation; DROP TABLE agent_owner_conversation; DELETE FROM role_permission WHERE permission_code = 'owner-conversation.ensure.self'; DELETE FROM permission WHERE code = 'owner-conversation.ensure.self';");
  if (version < 5) database.exec("DROP TABLE wake_delivery; DROP TABLE wake_rule_agent; DROP TABLE wake_rule; ALTER TABLE listener_run DROP COLUMN controller_bound; DELETE FROM role_permission WHERE permission_code LIKE 'wake-rule.%' OR permission_code = 'wake-delivery.receive.self'; DELETE FROM permission WHERE code LIKE 'wake-rule.%' OR code = 'wake-delivery.receive.self';");
  if (version < 3) database.exec('DROP TABLE fleet_message_delivery; DROP TABLE fleet_message; DROP TABLE fleet_connection; DROP INDEX uq_fleet_credential_id_fleet; ALTER TABLE fleet DROP COLUMN delivery_enabled;');
  if (version < 4) database.exec("ALTER TABLE agent_room_grant DROP COLUMN admission_kind; ALTER TABLE agent_room_grant DROP COLUMN invitation_event_id; ALTER TABLE room_grant_application DROP COLUMN creator; DELETE FROM role_permission WHERE permission_code = 'room-invitation.accept.self'; DELETE FROM permission WHERE code = 'room-invitation.accept.self';");
  if (version === 1) database.exec("DROP INDEX ix_member_invitation_creator_created; ALTER TABLE instance_policy DROP COLUMN signup_mode; ALTER TABLE instance_policy DROP COLUMN invitation_issuers; DELETE FROM role_permission WHERE permission_code = 'member.invite'; DELETE FROM permission WHERE code = 'member.invite';");
  database.pragma('user_version = ' + version);
  database.close();
  return { file, before };
}
test('policy forward migration preserves identities, invitation claims, audit and configured limits transactionally', () => {
  const { file, before } = previousDatabase();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 8);
    assert.deepEqual(database.prepare('SELECT * FROM principal').all(), before.principal);
    assert.deepEqual(database.prepare('SELECT * FROM member_invitation').all(), before.invitation);
    assert.deepEqual(database.prepare('SELECT * FROM audit_event').all(), before.audit);
    const policy = value(createRepositories(database).instancePolicy.find({ id: 'instance' }))!;
    assert.equal(policy.revision, 19);
    assert.equal(policy.maxOwnerAgents, 15);
    assert.equal(policy.agentInstructions, 'Keep private configuration.');
    assert.equal(policy.signupMode, 'invitation');
    assert.equal(policy.invitationIssuers, 'administrators');
    const grants = database.prepare("SELECT role_code FROM role_permission WHERE permission_code = 'member.invite' ORDER BY role_code").all();
    assert.deepEqual(grants, [{ role_code: 'administrator' }, { role_code: 'member' }]);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally { database.close(); }
  const reopened = openStore(file); reopened.close();
});

test('owner conversation migration preserves version five data and only adds reference authority and empty bindings', () => {
  const { file } = previousDatabase(5), previous = new Database(file);
  const tables = (previous.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('permission','role_permission') ORDER BY name").all() as { name: string }[]).map(row => row.name);
  const before = new Map(tables.map(table => [table, previous.prepare('SELECT * FROM ' + table).all()]));
  previous.close();
  const migrated = openStore(file);
  try {
    assert.equal(migrated.pragma('user_version', { simple: true }), 8);
    for (const table of tables) assert.deepEqual(migrated.prepare('SELECT * FROM ' + table).all(), before.get(table), table);
    assert.deepEqual(migrated.prepare('SELECT * FROM agent_owner_conversation').all(), []);
    assert.deepEqual(migrated.prepare("SELECT role_code FROM role_permission WHERE permission_code='owner-conversation.ensure.self'").all(), [{ role_code: 'agent' }]);
    assert.deepEqual(migrated.pragma('foreign_key_check'), []);
    assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
  } finally { migrated.close(); }
});

test('failed owner conversation migration rolls back its table and preserves the version five store', () => {
  const { file, before } = previousDatabase(5), previous = new Database(file);
  previous.exec('CREATE INDEX ix_agent_owner_conversation_owner ON principal(id)'); previous.close();
  assert.throws(() => openStore(file), /already exists/);
  const inspected = new Database(file);
  try {
    assert.equal(inspected.pragma('user_version', { simple: true }), 5);
    assert.deepEqual(inspected.prepare("SELECT name FROM sqlite_schema WHERE name='agent_owner_conversation'").all(), []);
    assert.deepEqual(inspected.prepare('SELECT * FROM principal').all(), before.principal);
    assert.deepEqual(inspected.prepare('SELECT * FROM audit_event').all(), before.audit);
  } finally { inspected.close(); }
});

test('fleet control forward migration preserves prior fleets and private controller authority', () => {
  const { file } = previousDatabase(2), old = new Database(file);
  old.exec("INSERT INTO fleet(id,label,controller_name,revision,updated_at,owner_id,fleet_key,created_at) VALUES('fleet','Private team','laptop',5,12,'owner','team',12); INSERT INTO fleet_credential(id,fleet_id,secret_hash,created_at) VALUES('credential','fleet','private-secret-hash',12);");
  const credentials = old.prepare('SELECT * FROM fleet_credential').all(); old.close();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 8);
    assert.deepEqual(database.prepare('SELECT * FROM fleet_credential').all(), credentials);
    const fleet = value(createRepositories(database).fleet.findById('fleet'))!;
    assert.equal(fleet.revision, 5); assert.equal(fleet.deliveryEnabled, true);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.deepEqual(database.prepare('SELECT * FROM fleet_connection').all(), []);
    assert.deepEqual(database.prepare('SELECT * FROM fleet_message').all(), []);
  } finally { database.close(); }
});
test('native invitation migration preserves managed grants, delegation, credentials and applied observations', () => {
  const { file } = previousDatabase(3), old = new Database(file);
  old.exec(`
    INSERT INTO principal(id,matrix_user_id,kind,status,revision,created_at) VALUES('agent','@agent:test','agent','active',23,12);
    INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode) VALUES('agent','agent','owner','owner');
    INSERT INTO agent_credential(agent_id,provisioning_password,access_token,updated_at) VALUES('agent','private-password','private-token',12);
    INSERT INTO agent_room_grant(agent_id,room_id,generation,authorizer_id,added_by_id,access_mode,power_level,muted,revision,access_revision,updated_at)
      VALUES('agent','!private:test','generation','owner','owner','custom',25,1,9,7,12);
    INSERT INTO agent_room_permission(agent_id,room_id,generation,permission_code,grant_scope,granted_by_member_id,granted_at)
      VALUES('agent','!private:test','generation','room.agent.invite','agent_room','owner',12);
    INSERT INTO room_grant_application(agent_id,room_id,observed_generation,applied_revision,applied_access_revision,membership,power_level,last_attempt_at,last_success_at,next_check_at)
      VALUES('agent','!private:test','generation',9,7,'join',25,12,12,300);
    INSERT INTO fleet(id,label,controller_name,revision,updated_at,owner_id,fleet_key,created_at) VALUES('fleet','Private team','laptop',5,12,'owner','team',12);
    INSERT INTO fleet_credential(id,fleet_id,secret_hash,created_at) VALUES('credential','fleet','private-secret-hash',12);
  `);
  const tables = ['principal', 'agent', 'agent_credential', 'agent_room_permission', 'room_grant_application', 'fleet', 'fleet_credential'];
  const before = new Map(tables.map(table => [table, old.prepare('SELECT *' + (table === 'room_grant_application' ? ', 0 AS creator' : '') + ' FROM ' + table).all()]));
  const grants = old.prepare("SELECT *, NULL AS invitation_event_id, 'managed' AS admission_kind FROM agent_room_grant").all();
  old.close();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 8);
    for (const table of tables) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), before.get(table));
    assert.deepEqual(database.prepare('SELECT * FROM agent_room_grant').all(), grants);
    assert.deepEqual(database.prepare("SELECT role_code FROM role_permission WHERE permission_code='room-invitation.accept.self'").all(), [{ role_code: 'agent' }]);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    const migrated = value(createRepositories(database).agentRoomGrant.find({ agentId: 'agent', roomId: '!private:test' }))!;
    assert.equal(migrated.invitationEventId, null);
    assert.equal(migrated.admissionKind, 'managed');
    assert.equal(migrated.generation, 'generation');
    assert.equal(migrated.powerLevel, 25);
    assert.equal(migrated.muted, true);
  } finally { database.close(); }
  const reopened = openStore(file); reopened.close();
});
test('failed migration rolls back columns and version without mutating existing data', () => {
  const { file, before } = previousDatabase();
  const previous = new Database(file);
  previous.exec('CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_at)');
  previous.close();
  assert.throws(() => openStore(file), /already exists/);
  const inspected = new Database(file);
  try {
    assert.equal(inspected.pragma('user_version', { simple: true }), 1);
    const columns = inspected.pragma('table_info(instance_policy)') as { name: string }[];
    assert(!columns.some(column => ['signup_mode', 'invitation_issuers'].includes(column.name)));
    assert.deepEqual(inspected.prepare('SELECT * FROM principal').all(), before.principal);
    assert.deepEqual(inspected.prepare('SELECT * FROM audit_event').all(), before.audit);
  } finally { inspected.close(); }
});

test('Wake-up schema migration preserves existing native access, controller authority and listener history', () => {
  const { file } = previousDatabase(4), old = new Database(file);
  old.exec(`
    INSERT INTO principal(id,matrix_user_id,kind,status,revision,created_at) VALUES('agent','@agent:test','agent','active',23,12);
    INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode) VALUES('agent','agent','owner','owner');
    INSERT INTO agent_credential(agent_id,provisioning_password,access_token,updated_at) VALUES('agent','private-password','private-token',12);
    INSERT INTO agent_room_grant(agent_id,room_id,generation,authorizer_id,added_by_id,access_mode,muted,revision,access_revision,updated_at,admission_kind,invitation_event_id)
      VALUES('agent','!private:test','generation','owner','owner','reply',0,9,7,12,'invitation','$invite');
    INSERT INTO fleet(id,label,controller_name,revision,updated_at,owner_id,fleet_key,created_at,delivery_enabled) VALUES('fleet','Private team','laptop',5,12,'owner','team',12,0);
    INSERT INTO fleet_credential(id,fleet_id,secret_hash,created_at) VALUES('credential','fleet','private-secret-hash',12);
    INSERT INTO listener_run(id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,stopped_at)
      VALUES('run','agent','old-release',12,100,88,17,100);
  `);
  const tables = ['principal', 'agent', 'agent_credential', 'agent_room_grant', 'fleet', 'fleet_credential'];
  const before = new Map(tables.map(table => [table, old.prepare('SELECT * FROM ' + table).all()]));
  const runs = old.prepare('SELECT *, 0 AS controller_bound FROM listener_run').all(); old.close();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 8);
    for (const table of tables) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), before.get(table));
    assert.deepEqual(database.prepare('SELECT * FROM listener_run').all(), runs);
    for (const table of ['wake_rule', 'wake_rule_agent', 'wake_delivery']) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), []);
    assert.deepEqual(database.prepare("SELECT role_code FROM role_permission WHERE permission_code='wake-rule.manage.any'").all(), [{ role_code: 'administrator' }]);
    assert.deepEqual(database.prepare("SELECT role_code FROM role_permission WHERE permission_code='wake-delivery.receive.self'").all(), [{ role_code: 'agent' }]);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally { database.close(); }
  const reopened = openStore(file); reopened.close();
});

test('failed Wake-up migration rolls back its tables, listener column and version', () => {
  const { file, before } = previousDatabase(4), old = new Database(file);
  old.exec('CREATE INDEX ix_wake_rule_owner_created ON member_invitation(created_at)'); old.close();
  assert.throws(() => openStore(file), /already exists/);
  const database = new Database(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 4);
    assert.deepEqual(database.prepare('SELECT * FROM principal').all(), before.principal);
    assert.equal((database.pragma('table_info(listener_run)') as { name: string }[]).some(column => column.name === 'controller_bound'), false);
    const tables = database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'wake_%' AND name != 'wake_notice'").get() as { count: number };
    assert.equal(tables.count, 0);
  } finally { database.close(); }
});

function previousOwnerConversations(version: 6 | 7 = 6) {
  const { file } = previousDatabase(version), database = new Database(file);
  database.exec(`
    INSERT INTO principal(id,matrix_user_id,kind,status,revision,created_at) VALUES('ada','@ada:test','agent','active',3,12),('jo','@jo:test','agent','active',4,12);
    INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode) VALUES('ada','agent','owner','owner'),('jo','agent','owner','owner');
    INSERT INTO agent_credential(agent_id,provisioning_password,access_token,updated_at) VALUES('ada','private-password','private-token',12);
    INSERT INTO agent_room_grant(agent_id,room_id,generation,authorizer_id,added_by_id,access_mode,muted,revision,access_revision,updated_at)
      VALUES('ada','!owner:test','generation','owner','owner','reply',0,9,7,12);
    INSERT INTO agent_owner_conversation(agent_id,owner_id,room_id,created_at) VALUES('ada','owner','!owner:test',12);
  `);
  return { file, database };
}

test('owner conversation exclusivity migration preserves every row and adds indexed admission guards', () => {
  const { file, database } = previousOwnerConversations();
  const tables = (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('permission','role_permission') ORDER BY name").all() as { name: string }[]).map(row => row.name);
  const before = new Map(tables.map(table => [table, database.prepare('SELECT * FROM ' + table).all()]));
  database.close();
  const migrated = openStore(file);
  try {
    assert.equal(migrated.pragma('user_version', { simple: true }), 8);
    for (const table of tables) assert.deepEqual(migrated.prepare('SELECT * FROM ' + table).all(), before.get(table), table);
    assert.throws(() => migrated.exec("INSERT INTO agent_room_grant(agent_id,room_id,generation,authorizer_id,added_by_id,access_mode,muted,revision,access_revision,updated_at) VALUES('jo','!owner:test','other','owner','owner','reply',0,0,0,12)"), /Another agent cannot join/);
    assert.deepEqual(migrated.pragma('foreign_key_check'), []);
    assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
  } finally { migrated.close(); }
});

test('unsafe owner conversation migration refuses third-party grants without modifying data or schema', () => {
  const { file, database } = previousOwnerConversations();
  database.exec("INSERT INTO agent_room_grant(agent_id,room_id,generation,authorizer_id,added_by_id,access_mode,muted,revision,access_revision,updated_at) VALUES('jo','!owner:test','other','owner','owner','reply',0,0,0,12)");
  const grants = database.prepare('SELECT * FROM agent_room_grant').all(), bindings = database.prepare('SELECT * FROM agent_owner_conversation').all();
  database.close();
  assert.throws(() => openStore(file), /exclusivity is violated/);
  const inspected = new Database(file);
  try {
    assert.equal(inspected.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(inspected.prepare('SELECT * FROM agent_room_grant').all(), grants);
    assert.deepEqual(inspected.prepare('SELECT * FROM agent_owner_conversation').all(), bindings);
    assert.deepEqual(inspected.prepare("SELECT name FROM sqlite_schema WHERE name='protect_owner_conversation_participant_insert'").all(), []);
  } finally { inspected.close(); }
});

test('runtime forward migration preserves every version seven application row and native binding', () => {
  const { file, database } = previousOwnerConversations(7);
  database.exec("INSERT INTO listener_run(id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,controller_bound,stopped_at) VALUES('original-run','ada','old-release',12,100,88,17,0,100)");
  const tables = (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('permission','role_permission') ORDER BY name").all() as { name: string }[]).map(row => row.name);
  const before = new Map(tables.map(table => [table, database.prepare('SELECT * FROM ' + table).all()]));
  database.close();
  const migrated = openStore(file);
  try {
    assert.equal(migrated.pragma('user_version', { simple: true }), 8);
    for (const table of tables) assert.deepEqual(migrated.prepare('SELECT * FROM ' + table).all(), before.get(table), table);
    assert.equal((migrated.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number }).count, 43);
    assert.deepEqual(migrated.pragma('foreign_key_check'), []);
    assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
  } finally { migrated.close(); }
});

test('runtime migration failure rolls back new tables and indexes without changing version seven data', () => {
  const { file, database } = previousOwnerConversations(7);
  const before = database.prepare('SELECT * FROM agent_owner_conversation').all();
  database.exec('CREATE INDEX ix_runtime_decision_pending ON member_invitation(created_at)');
  database.close();
  assert.throws(() => openStore(file), /already exists/);
  const inspected = new Database(file);
  try {
    assert.equal(inspected.pragma('user_version', { simple: true }), 7);
    assert.deepEqual(inspected.prepare('SELECT * FROM agent_owner_conversation').all(), before);
    assert.deepEqual(inspected.prepare("SELECT name FROM sqlite_schema WHERE name='runtime_decision' OR name='ux_listener_run_agent_binding'").all(), []);
    assert.deepEqual(inspected.pragma('foreign_key_check'), []);
  } finally { inspected.close(); }
});
