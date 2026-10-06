import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import { createDiscoveryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/discovery/index';
import { createListenerReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/listener-read/index';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

function value<T>(result: Result<T>): T { if (!result.ok) assert.fail(result.error.message); return result.value; }

test('canonical schema has singular normalized tables and enforced identity/role boundaries', () => {
  const database = openStore(':memory:');
  try {
    const repositories = createRepositories(database);
    const directory = createDirectoryRepository(database);
    const unit = createUnitOfWork(database);
    const tables = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[];
    assert.equal(tables.length, 63);
    assert(tables.every(table => !/json_valid/iu.test(table.sql)));
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.deepEqual(database.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    assert.equal(unit.run(() => {
      const inserted = repositories.principal.insert({ id: 'rolled-back', matrixUserId: '@rolled-back:test', kind: 'human', status: 'active', revision: 0, createdAt: 1 });
      if (!inserted.ok) return inserted;
      return failure('conflict', 'deliberate failed Result');
    }).ok, false);
    assert.equal(value(repositories.principal.find({ id: 'rolled-back' })), null);
    assert.throws(() => unit.run(() => { throw new Error('exception rollback'); }), /exception rollback/u);
    value(unit.run(() => {
      for (const result of [
        repositories.principal.insert({ id: 'human', matrixUserId: '@human:test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }),
        repositories.member.insert({ principalId: 'human', principalKind: 'human', displayName: 'Human' }),
        repositories.principalRole.insert({ principalId: 'human', principalKind: 'human', roleCode: 'administrator', assignedByMemberId: null, assignedAt: 1 }),
        repositories.principalApplication.insert({ principalId: 'human', appliedRevision: null, appliedIntentHash: null, appliedStatus: null, nativeDisplayName: null, lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: 1, errorCode: null, errorMessage: null }),
      ]) if (!result.ok) return result;
      return success(undefined);
    }));
    assert.equal(value(directory.member('human'))?.member.displayName, 'Human');
    assert.equal(value(directory.members({ page: 1, pageSize: 20 })).totalItems, 1);
    assert(value(directory.permissions('human')).includes('policy.manage'));
    assert.equal(value(directory.activeAdministratorCount()), 1);
    assert.equal(value(directory.agents({ page: 1, pageSize: 20, statuses: ['active'], search: '' })).totalItems, 0);
    value(repositories.principal.insert({ id: 'agent', matrixUserId: '@agent:test', kind: 'agent', status: 'active', revision: 0, createdAt: 1 }));
    value(repositories.agent.insert({ principalId: 'agent', principalKind: 'agent', ownerId: 'human', displayNameOverride: null, wakeMode: 'selected' }));
    assert.equal(repositories.principalRole.insert({ principalId: 'agent', principalKind: 'agent', roleCode: 'administrator', assignedByMemberId: 'human', assignedAt: 1 }).ok, false);
    value(repositories.principalRole.insert({ principalId: 'agent', principalKind: 'agent', roleCode: 'agent', assignedByMemberId: 'human', assignedAt: 1 }));
    value(repositories.agentName.insert({ name: 'alpha', requestId: null, instanceKey: null, agentId: 'agent' }));
    value(repositories.principalApplication.insert({ principalId: 'agent', appliedRevision: null, appliedIntentHash: null, appliedStatus: null, nativeDisplayName: null, lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: 1, errorCode: null, errorMessage: null }));
    assert.equal(value(directory.agents({ page: 1, pageSize: 20, statuses: ['active'], search: 'alpha', ownerId: 'human' })).totalItems, 0);
    value(repositories.fleet.insert({ id: 'fleet', archivedAt: null, ownerId: 'human', fleetKey: 'team', label: 'Team', controllerName: 'Computer', deliveryEnabled: true, revision: 0, createdAt: 1, updatedAt: 1 }));
    value(repositories.fleetInstance.insert({ ownerId: 'human', fleetKey: 'team', instanceKey: 'alpha', agentId: 'agent', retiredAt: null }));
    value(repositories.fleetCredential.insert({ id: 'credential', fleetId: 'fleet', secretHash: 'hash', createdAt: 1, revokedAt: null }));
    value(repositories.fleetConnection.save({ fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential', lastSeenAt: 1, expiresAt: 1000, closedAt: null }));
    assert.equal(value(directory.agents({ page: 1, pageSize: 20, statuses: ['active'], search: 'alpha', ownerId: 'human' })).items[0]?.name, 'alpha');
    assert.equal(value(directory.activeAgentCount('human')), 1);
    assert.equal(value(directory.activePrincipals()).length, 2);
    const discovery = createDiscoveryRepository(database);
    const identities = value(discovery.principals({ page: 1, pageSize: 1, kind: 'all', search: '' }));
    assert.equal(identities.totalItems, 2);
    assert.equal(identities.items.length, 1);
    assert.equal(value(discovery.principals({ page: 1, pageSize: 20, kind: 'agent', search: 'ALPHA' })).items[0]?.principalId, 'agent');
    assert.equal(value(directory.agents({ page: 1, pageSize: 20, statuses: ['active'], search: '', activity: { mode: 'include', agentIds: [] } })).totalItems, 0);
    value(repositories.listenerRun.insert({ id: 'run', agentId: 'agent', release: 'test', startedAt: 1, lastSeenAt: 10, activeMs: 9, messagesDelivered: 2, controller: { fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential' }, stoppedAt: null, disconnectRequestedAt: null }));
    const activity = createListenerReadRepository(database);
    assert.deepEqual(value(activity.reportingAgentIds(5, false, 10)), ['agent']);
    assert.equal(value(activity.activeCount('agent', 5, 10)), 1);
    assert.equal(value(activity.totals(['agent']))[0]?.messagesDelivered, 2);
    value(repositories.agentRoomGrant.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', authorizerId: 'human', addedById: 'human', invitationEventId: null, admissionKind: 'managed', accessMode: 'reply', powerLevel: null, muted: false, revision: 0, accessRevision: 0, updatedAt: 1 }));
    assert.equal(value(repositories.agentRoomGrant.find({ agentId: 'agent', roomId: '!room:test' }))?.muted, false);
    assert.equal(repositories.agentRoomPermission.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', permissionCode: 'policy.manage', grantScope: 'agent_room', grantedByMemberId: 'human', grantedAt: 1 }).ok, false);
    value(repositories.agentRoomPermission.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', permissionCode: 'room.agent.invite', grantScope: 'agent_room', grantedByMemberId: 'human', grantedAt: 1 }));
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
