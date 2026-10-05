import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { value } from './support/application.js';

function policyStore() {
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
  return database;
}

test('normalized requested and approved policies enforce principal, catalog, owner and fleet boundaries with indexed cascades', () => {
  const database = policyStore();
  try {
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
