import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { value } from './support/application.js';

function previousDatabase(version: 1 | 2 | 3 = 1) {
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
  if (version < 3) database.exec('DROP TABLE fleet_message_delivery; DROP TABLE fleet_message; DROP TABLE fleet_connection; DROP INDEX uq_fleet_credential_id_fleet; ALTER TABLE fleet DROP COLUMN delivery_enabled;');
  database.exec("ALTER TABLE agent_room_grant DROP COLUMN admission_kind; ALTER TABLE agent_room_grant DROP COLUMN invitation_event_id; ALTER TABLE room_grant_application DROP COLUMN creator; DELETE FROM role_permission WHERE permission_code = 'room-invitation.accept.self'; DELETE FROM permission WHERE code = 'room-invitation.accept.self';");
  if (version === 1) database.exec("DROP INDEX ix_member_invitation_creator_created; ALTER TABLE instance_policy DROP COLUMN signup_mode; ALTER TABLE instance_policy DROP COLUMN invitation_issuers; DELETE FROM role_permission WHERE permission_code = 'member.invite'; DELETE FROM permission WHERE code = 'member.invite';");
  database.pragma('user_version = ' + version);
  database.close();
  return { file, before };
}
test('policy forward migration preserves identities, invitation claims, audit and configured limits transactionally', () => {
  const { file, before } = previousDatabase();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 4);
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

test('fleet control forward migration preserves prior fleets and private controller authority', () => {
  const { file } = previousDatabase(2), old = new Database(file);
  old.exec("INSERT INTO fleet(id,label,controller_name,revision,updated_at,owner_id,fleet_key,created_at) VALUES('fleet','Private team','laptop',5,12,'owner','team',12); INSERT INTO fleet_credential(id,fleet_id,secret_hash,created_at) VALUES('credential','fleet','private-secret-hash',12);");
  const credentials = old.prepare('SELECT * FROM fleet_credential').all(); old.close();
  const database = openStore(file);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 4);
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
    assert.equal(database.pragma('user_version', { simple: true }), 4);
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
