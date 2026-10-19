import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import { createDiscoveryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/discovery/index';
import { createListenerReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/listener-read/index';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { readFileSync } from 'node:fs';
import { migrationChange, migrationQuery } from './support/migration-data.js';

function value<T>(result: Result<T>): T { if (!result.ok) assert.fail(result.error.message); return result.value; }

test('canonical schema has singular normalized tables and enforced identity/role boundaries', () => {
  const definition = JSON.parse(readFileSync(new URL('../../database/management/sqlite/schema.json', import.meta.url), 'utf8')) as {
    parts: Record<string, string>; initialization: string[];
  };
  assert.equal(new Set(definition.initialization).size, definition.initialization.length, 'Every schema owner is initialized once');
  assert.deepEqual(Object.keys(definition.parts).sort(), [...definition.initialization].sort(), 'No unused or superseded schema definitions');
  const database = openTestStore(':memory:');
  try {
    const repositories = createRepositories(database);
    const directory = createDirectoryRepository(database);
    const unit = createUnitOfWork(database);
    const tables = executeSelect(database, metadataSchema, query => query.from('sqlite_schema')
      .where(row => row.type === 'table' && !row.name.startsWith('sqlite_') && row.name !== 'knex_migrations' && row.name !== 'knex_migrations_lock')
      .select(row => ({ name: row.name, sql: row.sql })));
    assert.equal(tables.length, 57);
    assert(tables.every(table => table.sql !== null && (!/json_valid/iu.test(table.sql) || ['agent_room_grant', 'room_grant_application'].includes(table.name))));
    const nativeTables = tables.filter(table => ['agent_room_grant', 'room_grant_application'].includes(table.name));
    assert(nativeTables.every(table => /native_access TEXT CHECK\(native_access IS NULL OR \(json_valid/iu.test(table.sql ?? '')));
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
    assert.deepEqual(sqliteMetadata.integrityResults(database), [{ integrity_check: 'ok' }]);
    assert.equal(unit.run(() => {
      const inserted = repositories.principal.insert({ id: 'rolled-back', backendUserId: '@rolled-back:test', kind: 'human', status: 'active', revision: 0, createdAt: 1 });
      if (!inserted.ok) return inserted;
      return failure('conflict', 'deliberate failed Result');
    }).ok, false);
    assert.equal(value(repositories.principal.find({ id: 'rolled-back' })), null);
    assert.throws(() => unit.run(() => { throw new Error('exception rollback'); }), /exception rollback/u);
    value(unit.run(() => {
      for (const result of [
        repositories.principal.insert({ id: 'human', backendUserId: '@human:test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }),
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
    value(repositories.principal.insert({ id: 'agent', backendUserId: '@agent:test', kind: 'agent', status: 'active', revision: 0, createdAt: 1 }));
    value(repositories.agent.insert({ principalId: 'agent', principalKind: 'agent', ownerId: 'human', wakeMode: 'selected' }));
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
    for (const column of ['controller_fleet_id', 'controller_connection_id', 'controller_credential_id']) {
      assert.throws(() => migrationChange(database, migrationQuery('listener_run').where('id', 'run').update({ [column]: null })), /immutable/u, column);
      assert.throws(() => migrationChange(database, migrationQuery('listener_run').where('id', 'run').update({ [column]: 'other' })), /immutable/u, column);
    }
    assert.throws(() => migrationChange(database, migrationQuery('listener_run').where('id', 'run').update({ release: null })), /NOT NULL/u);
    for (const release of ['', 'x'.repeat(201)]) {
      assert.throws(() => migrationChange(database, migrationQuery('listener_run').where('id', 'run').update({ release })), /CHECK/u);
    }
    assert.equal(value(repositories.listenerRun.find({ id: 'run' }))?.release, 'test');
    value(repositories.agentRoomGrant.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', authorizerId: 'human', addedById: 'human', invitationEventId: null, admissionKind: 'managed', accessMode: 'reply', nativeAccess: null, muted: false, revision: 0, accessRevision: 0, updatedAt: 1 }));
    assert.equal(value(repositories.agentRoomGrant.find({ agentId: 'agent', roomId: '!room:test' }))?.muted, false);
    assert.equal(repositories.agentRoomPermission.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', permissionCode: 'policy.manage', grantScope: 'agent_room', grantedByMemberId: 'human', grantedAt: 1 }).ok, false);
    value(repositories.agentRoomPermission.insert({ agentId: 'agent', roomId: '!room:test', generation: 'generation', permissionCode: 'room.agent.invite', grantScope: 'agent_room', grantedByMemberId: 'human', grantedAt: 1 }));
    const run = value(repositories.listenerRun.find({ id: 'run' }))!;
    value(repositories.listenerRun.update({ ...run, stoppedAt: 20 }));
    migrationChange(database, migrationQuery('fleet_connection').where('fleet_id', 'fleet').delete());
    const stopped = value(repositories.listenerRun.find({ id: 'run' }))!;
    assert.deepEqual(stopped.controller, { fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential' });
    assert.equal(stopped.stoppedAt, 20);
    assert.equal(value(activity.activeCount('agent', 5, 20)), 0);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});
