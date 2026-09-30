import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSchema } from '@crossfire/adapter-sqlite/schema/create-schema';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@crossfire/adapter-sqlite/repository/directory/index';
import { createDiscoveryRepository } from '@crossfire/adapter-sqlite/repository/discovery/index';
import { createListenerReadRepository } from '@crossfire/adapter-sqlite/repository/listener-read/index';
import { createRoomGrantReadRepository } from '@crossfire/adapter-sqlite/repository/room-grant-read/index';
import { roomGrants } from '@crossfire/contracts/schema/query';
import type { Result } from '@crossfire/kernel/result';

function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

test('actual Tinqer owner pages seek indexes and hydrate activity and selected identities in constant query counts', scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) {
    if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement);
  } });
  scope.after(() => database.close());
  database.pragma('foreign_keys = ON');
  createSchema(database);
  const repositories = createRepositories(database);
  const directory = createDirectoryRepository(database);
  const discovery = createDiscoveryRepository(database);
  const activity = createListenerReadRepository(database);
  const application = (principalId: string) => value(repositories.principalApplication.insert({
    principalId, appliedRevision: 0, appliedIntentHash: 'applied', appliedStatus: 'active',
    nativeDisplayName: principalId, lastAttemptAt: 1, lastSuccessAt: 1, nextCheckAt: 100,
    errorCode: null, errorMessage: null,
  }));
  database.transaction(() => {
    for (let ownerIndex = 0; ownerIndex < 5; ownerIndex++) {
      const ownerId = 'owner-' + ownerIndex;
      value(repositories.principal.insert({ id: ownerId, matrixUserId: '@' + ownerId + ':test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.member.insert({ principalId: ownerId, principalKind: 'human', displayName: ownerId }));
      application(ownerId);
      for (let agentIndex = 0; agentIndex < 200; agentIndex++) {
        const agentId = ownerId + '-agent-' + String(agentIndex).padStart(3, '0');
        value(repositories.principal.insert({ id: agentId, matrixUserId: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 0, createdAt: agentIndex }));
        value(repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId, displayNameOverride: null, wakeMode: 'owner' }));
        value(repositories.agentName.insert({ name: agentId, requestId: null, instanceKey: null, agentId }));
        application(agentId);
        for (let runIndex = 0; runIndex < 3; runIndex++) value(repositories.listenerRun.insert({
          id: agentId + '-run-' + runIndex, agentId, release: 'proof', startedAt: 1,
          lastSeenAt: 100 + runIndex, activeMs: 100, messagesDelivered: 2,
          stoppedAt: runIndex === 2 ? null : 101, disconnectRequestedAt: null,
        }));
      }
    }
  })();
  database.exec('ANALYZE');
  const plan = (statement: string) => (database.prepare('EXPLAIN QUERY PLAN ' + statement).all() as { detail: string }[]).map(row => row.detail).join('\n');
  for (const pageSize of [1, 20, 100]) {
    statements = [];
    const started = performance.now();
    const page = value(directory.agents({ ownerId: 'owner-2', statuses: ['active'], search: '', page: 2, pageSize }));
    assert.equal(page.totalItems, 200);
    assert.equal(page.items.length, pageSize);
    assert(page.items.every(row => row.agent.ownerId === 'owner-2'));
    assert.equal(statements.length, 2, 'One count and one joined page query');
    for (const statement of statements) assert.match(plan(statement), /SEARCH .*ix_agent_owner.*owner_id=/u);
    const pagination = /LIMIT (\d+(?:\.0)?) OFFSET (\d+(?:\.0)?)$/u.exec(statements[1]!);
    assert(pagination);
    assert.equal(Number(pagination[1]), pageSize);
    assert.equal(Number(pagination[2]), pageSize);
    const agentIds = page.items.map(row => row.agent.principalId);
    const totals = value(activity.totals(agentIds));
    assert.equal(totals.length, pageSize);
    assert(totals.every(row => row.messagesDelivered === 6 && row.activeMs === 300));
    const active = value(activity.active(agentIds, 50));
    assert.equal(active.length, pageSize);
    assert(active.every(row => row.stoppedAt === null));
    assert.equal(statements.length, 4, 'Activity aggregates are page-wide, not per-agent');
    for (const statement of statements.slice(2)) assert.match(plan(statement), /SEARCH .*ix_listener_run_agent.*agent_id=/u);
    const identities = value(discovery.selected([...agentIds, 'owner-2']));
    assert.equal(identities.length, pageSize + 1);
    assert.equal(statements.length, 6, 'Selected identities hydrate through two batched queries');
    scope.diagnostic(JSON.stringify({ agents: 1000, listenerRuns: 3000, page: 2, pageSize,
      statements: statements.length, elapsedMs: Math.ceil(performance.now() - started) }));
  }
  statements = [];
  const other = value(directory.agents({ ownerId: 'owner-3', statuses: ['active'], search: 'owner-2', page: 1, pageSize: 100 }));
  assert.equal(other.totalItems, 0);
  assert.equal(other.items.length, 0);
  assert.equal(statements.length, 2);
  const agentId = 'owner-2-agent-000';
  database.transaction(() => {
    for (let roomIndex = 0; roomIndex < 200; roomIndex++) value(repositories.agentRoomGrant.insert({
      agentId, roomId: '!room-' + String(roomIndex).padStart(3, '0') + ':test', generation: 'generation-' + roomIndex,
      authorizerId: 'owner-2', addedById: 'owner-2', accessMode: 'reply', powerLevel: null,
      muted: false, revision: 0, accessRevision: 0, updatedAt: 1,
    }));
  })();
  const grants = createRoomGrantReadRepository(database);
  statements = [];
  const filter = value(roomGrants(new URLSearchParams({ roomIds: '["!room-199:test"]', pageSize: '1' })));
  const lastRoom = value(grants.page(agentId, filter));
  assert.equal(lastRoom.totalItems, 1);
  assert.equal(lastRoom.items[0]?.roomId, '!room-199:test');
  assert.equal(lastRoom.items[0]?.accessMode, 'reply');
  assert.equal(statements.length, 2, 'Visible room grants are filtered before paging, including grants beyond the first 100');
  assert.equal(value(grants.page(agentId, { page: 1, pageSize: 100, roomIds: [] })).totalItems, 0);
  for (const source of ['not-json', '["invalid"]', '["!room:test","!room:test"]', JSON.stringify(Array(101).fill('!room:test'))]) {
    assert.equal(roomGrants(new URLSearchParams({ roomIds: source })).ok, false);
  }
  assert.equal(roomGrants(new URLSearchParams('roomIds=[]&roomIds=[]')).ok, false);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('sender identity batches seek exact Matrix indexes across large human and agent populations', scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) {
    if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement);
  } });
  scope.after(() => database.close());
  database.pragma('foreign_keys = ON');
  createSchema(database);
  const repositories = createRepositories(database), discovery = createDiscoveryRepository(database);
  database.transaction(() => {
    for (let index = 0; index < 1000; index++) {
      const ownerId = 'human-' + index, agentId = 'agent-' + index;
      value(repositories.principal.insert({ id: ownerId, matrixUserId: '@' + ownerId + ':test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.member.insert({ principalId: ownerId, principalKind: 'human', displayName: ownerId }));
      value(repositories.principal.insert({ id: agentId, matrixUserId: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId, displayNameOverride: null, wakeMode: 'owner' }));
    }
  })();
  database.exec('ANALYZE');
  for (const count of [1, 20, 100]) {
    statements = [];
    const ids = Array.from({ length: count }, (_, index) => '@' + (index % 2 ? 'agent-' : 'human-') + index + ':test');
    const resolved = value(discovery.identities(ids));
    assert.equal(resolved.length, count);
    assert.equal(statements.length, 2, 'Sender kinds and owners use two batch queries, never per-message lookups');
    for (const identity of resolved) assert.equal(identity.ownerMatrixId, identity.kind === 'agent'
      ? identity.matrixUserId.replace('@agent-', '@human-') : null);
    for (const statement of statements) {
      const plan = (database.prepare('EXPLAIN QUERY PLAN ' + statement).all() as { detail: string }[]).map(row => row.detail).join('\n');
      assert.match(plan, /SEARCH .*matrix_user_id=/u);
      assert(!plan.includes('SCAN '), 'Exact sender resolution must not scan the principal or agent tables');
    }
  }
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});
