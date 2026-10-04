import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { value } from './support/application.js';
import { createSchema } from '@crossfire/adapter-sqlite/schema/create-schema';

const relations = ['enrollment_item_policy', 'enrollment_item_permission', 'enrollment_item_wake_sender', 'fleet_instance_policy', 'fleet_instance_permission'];
function previousStore() {
  const database = openStore(':memory:'), repositories = createRepositories(database);
  for (const id of ['owner', 'other']) {
    value(repositories.principal.insert({ id, matrixUserId: '@' + id + ':test', kind: 'human', status: 'active', revision: 3, createdAt: 1 }));
    value(repositories.member.insert({ principalId: id, principalKind: 'human', displayName: id }));
  }
  value(repositories.principal.insert({ id: 'ada', matrixUserId: '@ada:test', kind: 'agent', status: 'active', revision: 7, createdAt: 1 }));
  value(repositories.agent.insert({ principalId: 'ada', principalKind: 'agent', ownerId: 'owner', displayNameOverride: null, wakeMode: 'owner-agents' }));
  value(repositories.agentCredential.insert({ agentId: 'ada', provisioningPassword: 'private-password', accessToken: 'private-token', updatedAt: 10 }));
  value(repositories.agentName.insert({ name: 'ada', agentId: 'ada', requestId: null, instanceKey: null }));
  value(repositories.fleet.insert({ id: 'fleet', ownerId: 'owner', fleetKey: 'agreements', label: 'Agreements', controllerName: 'Computer',
    deliveryEnabled: true, revision: 4, createdAt: 10, updatedAt: 10 }));
  value(repositories.fleetInstance.insert({ ownerId: 'owner', fleetKey: 'agreements', instanceKey: 'ada', agentId: 'ada' }));
  value(repositories.fleetCredential.insert({ id: 'controller', fleetId: 'fleet', secretHash: 'private-controller-hash', revokedAt: null, createdAt: 10 }));
  value(repositories.agentRoomGrant.insert({ agentId: 'ada', roomId: '!matter:test', generation: 'generation', authorizerId: 'owner', addedById: 'owner',
    admissionKind: 'managed', invitationEventId: null, accessMode: 'reply', powerLevel: null, muted: false, revision: 3, accessRevision: 1, updatedAt: 10 }));
  value(repositories.agentRoomPermission.insert({ agentId: 'ada', roomId: '!matter:test', generation: 'generation',
    permissionCode: 'room.agent.invite', grantScope: 'agent_room', grantedByMemberId: 'owner', grantedAt: 10 }));
  for (const table of [...relations].reverse()) database.exec('DROP TABLE ' + table);
  database.exec('DROP TABLE fleet_runtime_operation;');
  database.pragma('user_version = 9');
  return database;
}

test('fleet policy migration preserves every existing row and native credential without inventing owner approval', () => {
  const database = previousStore();
  try {
    const tables = (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const before = new Map(tables.map(table => [table, database.prepare('SELECT * FROM ' + table).all()]));
    assert.equal(tables.length, 48);
    createSchema(database);
    assert.equal(database.pragma('user_version', { simple: true }), 11);
    for (const table of tables) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), before.get(table), table);
    for (const table of relations) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), [], table);
    assert.equal(value(createRepositories(database).fleetPolicy.approved('ada')), null);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    createSchema(database);
  } finally { database.close(); }
});

test('failed fleet policy migration rolls back tables, indexes and version before any authority is modified', () => {
  const database = previousStore();
  try {
    database.exec('CREATE INDEX ix_fleet_instance_policy_owner ON principal(id)');
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 9);
    for (const table of relations) assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table), undefined);
    assert.equal(value(createRepositories(database).agentCredential.find({ agentId: 'ada' }))!.accessToken, 'private-token');
    assert.equal(value(createRepositories(database).agentRoomPermission.find({ agentId: 'ada', roomId: '!matter:test', permissionCode: 'room.agent.invite' }))!.generation, 'generation');
  } finally { database.close(); }
});

test('normalized requested and approved policies enforce principal, catalog, owner and fleet boundaries with indexed cascades', () => {
  const database = previousStore();
  try {
    createSchema(database);
    const repositories = createRepositories(database);
    value(repositories.enrollmentRequest.insert({ id: 'request', ownerId: 'owner', fleetKey: 'agreements', controllerName: 'Computer', controllerCredentialHash: 'hash',
      verificationCode: 'CODE00000000', claimHash: 'hash', rosterDigest: 'digest', status: 'pending', revision: 0, createdAt: 1, expiresAt: 100, decidedByMemberId: null, decidedAt: null }));
    value(repositories.enrollmentItem.insert({ requestId: 'request', instanceKey: 'ada', requestedName: 'ada', agentId: 'ada', outcome: 'existing', failureCode: null }));
    const key = { requestId: 'request', instanceKey: 'ada' }, requested = { wakeMode: 'selected' as const,
      senderIds: ['other', 'owner'], permissions: ['room.agent.invite' as const], expectedAgentRevision: 7 };
    value(repositories.fleetPolicy.insertRequested(key, requested));
    assert.deepEqual(value(repositories.fleetPolicy.requested(key.requestId)), [
      { ...requested, instanceKey: 'ada', senderMatrixIds: ['@other:test', '@owner:test'] },
    ]);
    assert.equal(repositories.fleetPolicy.approve({ agentId: 'ada', approvedByMemberId: 'other', approvedAt: 1, permissions: [] }).ok, false);
    value(repositories.fleetPolicy.approve({ agentId: 'ada', approvedByMemberId: 'owner', approvedAt: 10, permissions: ['room.agent.invite'] }));
    assert.deepEqual(value(repositories.fleetPolicy.approved('ada'))!.permissions, ['room.agent.invite']);
    assert.throws(() => database.prepare('INSERT INTO fleet_instance_permission VALUES (?, ?, ?)').run('ada', 'policy.manage', 'agent_room'));
    assert.throws(() => database.prepare('INSERT INTO enrollment_item_wake_sender VALUES (?, ?, ?)').run('request', 'ada', 'missing'));
    for (const name of ['ix_enrollment_item_permission_code', 'ix_enrollment_item_wake_sender_principal', 'ix_fleet_instance_policy_owner', 'ix_fleet_instance_permission_code']) {
      assert(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(name), name);
    }
    value(repositories.fleetInstance.remove({ ownerId: 'owner', fleetKey: 'agreements', instanceKey: 'ada' }));
    assert.equal(value(repositories.fleetPolicy.approved('ada')), null);
    assert.deepEqual(database.prepare('SELECT * FROM fleet_instance_permission').all(), []);
    assert(value(repositories.agentRoomPermission.find({ agentId: 'ada', roomId: '!matter:test', permissionCode: 'room.agent.invite' })), 'Grouping removal preserves explicitly granted room authority');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
