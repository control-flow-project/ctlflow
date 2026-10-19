import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { value } from './support/application.js';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrationChange, migrationQuery } from './support/migration-data.js';

function policyStore() {
  const database = openTestStore(':memory:'), repositories = createRepositories(database);
  for (const id of ['owner', 'other']) {
    value(repositories.principal.insert({ id, backendUserId: '@' + id + ':test', kind: 'human', status: 'active', revision: 3, createdAt: 1 }));
    value(repositories.member.insert({ principalId: id, principalKind: 'human', displayName: id }));
  }
  value(repositories.principal.insert({ id: 'ada', backendUserId: '@ada:test', kind: 'agent', status: 'active', revision: 7, createdAt: 1 }));
  value(repositories.agent.insert({ principalId: 'ada', principalKind: 'agent', ownerId: 'owner', wakeMode: 'selected' }));
  value(repositories.agentCredential.insert({ agentId: 'ada', provisioningPassword: 'private-password', accessToken: 'private-token', updatedAt: 10 }));
  value(repositories.agentName.insert({ name: 'ada', agentId: 'ada', requestId: null, instanceKey: null }));
  value(repositories.fleet.insert({ id: 'fleet', ownerId: 'owner', fleetKey: 'agreements', label: 'Agreements', controllerName: 'Computer',
    archivedAt: null, deliveryEnabled: true, revision: 4, createdAt: 10, updatedAt: 10 }));
  value(repositories.fleetInstance.insert({ ownerId: 'owner', fleetKey: 'agreements', instanceKey: 'ada', agentId: 'ada', retiredAt: null }));
  value(repositories.fleetCredential.insert({ id: 'controller', fleetId: 'fleet', secretHash: 'private-controller-hash', revokedAt: null, createdAt: 10 }));
  value(repositories.agentRoomGrant.insert({ agentId: 'ada', roomId: '!matter:test', generation: 'generation', authorizerId: 'owner', addedById: 'owner',
    admissionKind: 'managed', invitationEventId: null, accessMode: 'reply', nativeAccess: null, muted: false, revision: 3, accessRevision: 1, updatedAt: 10 }));
  value(repositories.agentRoomPermission.insert({ agentId: 'ada', roomId: '!matter:test', generation: 'generation',
    permissionCode: 'room.agent.invite', grantScope: 'agent_room', grantedByMemberId: 'owner', grantedAt: 10 }));
  return database;
}

test('current policy schema enforces principal, catalog, owner and fleet boundaries while preserving retired policy history', () => {
  const database = policyStore();
  try {
    const repositories = createRepositories(database);
    value(repositories.enrollmentRequest.insert({ id: 'request', ownerId: 'owner', fleetKey: 'agreements', controllerName: 'Computer', controllerCredentialHash: 'hash',
      verificationCode: 'CODE00000000', claimHash: 'hash', rosterDigest: 'digest', status: 'pending', revision: 0, createdAt: 1, expiresAt: 100, decidedByMemberId: null, decidedAt: null }));
    value(repositories.enrollmentItem.insert({ requestId: 'request', instanceKey: 'ada', requestedName: 'ada', agentId: 'ada', outcome: 'existing' }));
    const key = { requestId: 'request', instanceKey: 'ada' }, requested = { wakeMode: 'selected' as const,
      senders: ['other', 'owner'].map(principalId => ({ principalId, includeAgents: false })), permissions: ['room.agent.invite' as const], expectedAgentRevision: 7 };
    value(repositories.fleetPolicy.insertRequested(key, requested));
    assert.deepEqual(value(repositories.fleetPolicy.requested(key.requestId)), [
      { ...requested, instanceKey: 'ada', backendSenders: ['@other:test', '@owner:test'].map(backendUserId => ({ backendUserId, includeAgents: false })) },
    ]);
    assert.equal(repositories.fleetPolicy.approve({ agentId: 'ada', approvedByMemberId: 'other', approvedAt: 1, permissions: [] }).ok, false);
    value(repositories.fleetPolicy.approve({ agentId: 'ada', approvedByMemberId: 'owner', approvedAt: 10, permissions: ['room.agent.invite'] }));
    assert.deepEqual(value(repositories.fleetPolicy.approved('ada'))!.permissions, ['room.agent.invite']);
    assert.throws(() => migrationChange(database, migrationQuery('fleet_instance_permission')
      .insert({ agent_id: 'ada', permission_code: 'policy.manage', grant_scope: 'agent_room' })));
    assert.throws(() => migrationChange(database, migrationQuery('enrollment_item_wake_sender')
      .insert({ request_id: 'request', instance_key: 'ada', sender_principal_id: 'missing', include_agents: 0 })));
    for (const name of ['ix_enrollment_item_permission_code', 'ix_enrollment_item_wake_sender_principal', 'ix_fleet_instance_policy_owner', 'ix_fleet_instance_permission_code']) {
      assert(executeSelect(database, metadataSchema, (query, params) => query.from('sqlite_schema').where(row => row.type === 'index' && row.name === params.name).any(), { name }), name);
    }
    const binding = value(repositories.fleetInstance.findByAgent('ada'))!;
    value(repositories.fleetInstance.update({ ...binding, retiredAt: 10 }));
    assert.deepEqual(value(repositories.fleetPolicy.approved('ada'))!.permissions, ['room.agent.invite']);
    assert.deepEqual(executeSelect(database, schema, query => query.from('fleet_instance_permission')), [{ agent_id: 'ada', permission_code: 'room.agent.invite', grant_scope: 'agent_room' }]);
    assert(value(repositories.agentRoomPermission.find({ agentId: 'ada', roomId: '!matter:test', permissionCode: 'room.agent.invite' })), 'Retirement preserves explicitly granted room history without independent execution');
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});
