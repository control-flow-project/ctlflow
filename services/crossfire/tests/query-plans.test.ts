import { migrateFixture } from './support/storage.js';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import { createDiscoveryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/discovery/index';
import { createListenerReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/listener-read/index';
import { createRoomGrantReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/room-grant-read/index';
import { createRuntimeRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/runtime/index';
import { roomGrants } from '@ctlflow/crossfire-contracts/schema/query';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { canRetireAgent } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { readActivity } from '@ctlflow/crossfire-domain/listener/activity';

function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

test('actual Tinqer owner pages seek indexes and hydrate activity and selected identities in constant query counts', async scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) {
    if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement);
  } });
  cleanup(scope, () => database.close());
  database.pragma('foreign_keys = ON');
  await migrateFixture(database);
  const repositories = createRepositories(database);
  const directory = createDirectoryRepository(database);
  const discovery = createDiscoveryRepository(database);
  const activity = createListenerReadRepository(database);
  const runtime = createRuntimeRepository(database);
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
      const fleetId = 'fleet-' + ownerId, credentialId = 'credential-' + ownerId, connectionId = 'connection-' + ownerId;
      value(repositories.fleet.insert({ id: fleetId, ownerId, fleetKey: ownerId, label: ownerId, controllerName: 'Computer',
        revision: 0, deliveryEnabled: true, archivedAt: null, createdAt: 1, updatedAt: 1 }));
      value(repositories.fleetCredential.insert({ id: credentialId, fleetId, secretHash: 'hash-' + ownerId, createdAt: 1, revokedAt: null }));
      value(repositories.fleetConnection.save({ fleetId, credentialId, connectionId, lastSeenAt: 1, expiresAt: 1000, closedAt: null }));
      for (let agentIndex = 0; agentIndex < 200; agentIndex++) {
        const agentId = ownerId + '-agent-' + String(agentIndex).padStart(3, '0');
        value(repositories.principal.insert({ id: agentId, matrixUserId: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 0, createdAt: agentIndex }));
        value(repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId, wakeMode: 'selected' }));
        value(repositories.agentName.insert({ name: agentId, requestId: null, instanceKey: null, agentId }));
        application(agentId);
        value(repositories.fleetInstance.insert({ ownerId, fleetKey: ownerId, instanceKey: agentId, agentId, retiredAt: null }));
        for (let runIndex = 0; runIndex < 3; runIndex++) {
          const runId = agentId + '-run-' + runIndex;
          value(repositories.listenerRun.insert({ id: runId, agentId, release: 'proof', controller: { fleetId, connectionId, credentialId }, startedAt: 1,
            lastSeenAt: 100 + runIndex, activeMs: 100, messagesDelivered: 2,
            stoppedAt: runIndex === 2 ? null : 101, disconnectRequestedAt: null }));
          value(runtime.saveObservation(agentId, { runId, sessionId: 'shared', roomId: null, runtime: 'codex',
            state: runIndex === 2 ? 'sleeping' : 'failed', observedAt: 100 + runIndex, historyMode: 'shared',
            maxInputBytes: 100000, errorMessage: null, lastActivityAt: 90, historyAvailable: true, settings: [] }));
        }
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
    const observed = value(readActivity({ listenerRead: activity, clock: { now: () => 500 } }, agentIds));
    assert.equal(observed.size, pageSize);
    assert([...observed.values()].every(row => row.messagesDelivered === 6 && row.activeMs === 300
      && row.status === 'online' && row.activeRuns.length === 1 && row.activeRuns[0]?.stoppedAt === null));
    assert.equal(statements.length, 4, 'Complete domain activity, including controller authority, uses two page-wide queries');
    for (const statement of statements.slice(2)) assert.match(plan(statement), /SEARCH .*ix_listener_run_agent.*agent_id=/u);
    const identities = value(discovery.selected([...agentIds, 'owner-2']));
    assert.equal(identities.length, pageSize + 1);
    assert.equal(statements.length, 6, 'Selected identities hydrate through two batched queries');
    const summaries = value(runtime.summaries(agentIds));
    assert.equal(summaries.size, pageSize);
    assert([...summaries.values()].every(summary => summary.state === 'sleeping' && summary.historyAvailable === true));
    assert.equal(statements.length, 8, 'Native summaries use two page-wide queries, including tied run start times');
    assert.match(plan(statements[6]!), /SEARCH .*ix_listener_run_agent.*agent_id=/u);
    assert.match(plan(statements[7]!), /SEARCH .*runtime_observation.*run_id=/u);
    scope.diagnostic(JSON.stringify({ agents: 1000, listenerRuns: 3000, page: 2, pageSize,
      statements: statements.length, elapsedMs: Math.ceil(performance.now() - started) }));
    statements = [];
    const retirementStarted = performance.now(), retirement = value(activity.retirement({ agentIds }, 500));
    assert.equal(retirement.agents.length, pageSize);
    assert(retirement.agents.every(agent => agent.fleetId === 'fleet-owner-2' && agent.ownerActive
      && agent.hasObservedRuntime && agent.latestRun?.id === agent.agentId + '-run-2' && !canRetireAgent(agent, 500)));
    assert.equal(statements.length, 11, 'Retirement facts use eleven indexed batch queries for one, twenty or one hundred agents');
    assert.match(plan(statements[0]!), /SEARCH .*fleet_instance.*agent_id=/u);
    assert.match(plan(statements[2]!), /SEARCH .*ix_listener_run_agent.*agent_id=/u);
    assert.match(plan(statements[3]!), /SEARCH .*fleet_native_stop.*agent_id=/u);
    assert.match(plan(statements[4]!), /SEARCH .*runtime_observation.*agent_id=/u);
    assert.match(plan(statements[5]!), /SEARCH .*runtime_observation.*run_id=/u);
    assert.match(plan(statements[6]!), /SEARCH .*runtime_decision USING INDEX ix_runtime_decision_(agent_created|pending).*=/u);
    assert.match(plan(statements[7]!), /SEARCH .*wake_delivery.*agent_id=/u);
    assert.match(plan(statements[8]!), /SEARCH .*fleet_message_delivery.*status=/u);
    assert.match(plan(statements[9]!), /SEARCH .*fleet_connection.*fleet_id=/u);
    assert.match(plan(statements[10]!), /SEARCH .*fleet_credential.*id=/u);
    assert(!statements.join('\n').includes('review_text'), 'Eligibility must not hydrate native questions or provider payloads');
    scope.diagnostic(JSON.stringify({ agents: 1000, listenerRuns: 3000, retirementAgents: pageSize,
      statements: statements.length, elapsedMs: Math.ceil(performance.now() - retirementStarted) }));
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
      authorizerId: 'owner-2', addedById: 'owner-2', invitationEventId: null, admissionKind: 'managed', accessMode: 'reply', powerLevel: null,
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
  value(repositories.listenerRun.insert({ id: agentId + '-new-run', agentId, release: 'proof', controller: { fleetId: 'fleet-owner-2', connectionId: 'connection-owner-2', credentialId: 'credential-owner-2' },
    startedAt: 2, lastSeenAt: 103, activeMs: 0, messagesDelivered: 0, stoppedAt: null, disconnectRequestedAt: null }));
  value(runtime.saveObservation(agentId, { runId: agentId + '-new-run', sessionId: 'shared', roomId: null,
    runtime: 'codex', state: 'waking', observedAt: 103, historyMode: 'shared', maxInputBytes: 100000,
    errorMessage: null, lastActivityAt: 103, historyAvailable: true, settings: [] }));
  assert.equal(value(runtime.summaries([agentId])).get(agentId)?.state, 'waking', 'Start time takes priority over lexical run ID');
  assert.equal(value(runtime.summaries(['missing-agent'])).size, 0);
  statements = [];
  assert.equal(value(runtime.summaries([])).size, 0); assert.equal(statements.length, 0);
  assert.deepEqual(value(activity.retirement({ agentIds: [] }, 500)), { agents: [], pendingFleetIds: [] }); assert.equal(statements.length, 0);
  for (const contexts of [1, 100]) {
    for (let position = 0; position < contexts; position++) value(runtime.saveObservation(agentId, {
      runId: agentId + '-new-run', sessionId: 'context-' + position, roomId: '!context-' + position + ':test', runtime: 'codex',
      state: 'idle', observedAt: position, historyMode: 'per-room', maxInputBytes: 100000, errorMessage: null,
      lastActivityAt: position, historyAvailable: true,
      settings: [{ name: 'model', configured: 'configured', effective: 'effective' }] }));
    statements = [];
    const observed = value(runtime.observation(agentId));
    assert.equal(observed.length, contexts + 1);
    assert(observed.filter(context => context.roomId !== null).every(context => context.settings.length === 1));
    assert.equal(statements.length, 3, 'Runtime contexts and settings hydrate in three indexed queries, not one per history');
    const runPlan = database.prepare('EXPLAIN QUERY PLAN ' + statements[0]).all() as { detail: string }[];
    assert(runPlan.some(step => step.detail.includes('ix_listener_run_agent_started')), JSON.stringify(runPlan));
  }
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('sender identity batches seek exact Matrix indexes across large human and agent populations', async scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) {
    if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement);
  } });
  cleanup(scope, () => database.close());
  database.pragma('foreign_keys = ON');
  await migrateFixture(database);
  const repositories = createRepositories(database), discovery = createDiscoveryRepository(database);
  database.transaction(() => {
    for (let index = 0; index < 1000; index++) {
      const ownerId = 'human-' + index, agentId = 'agent-' + index;
      value(repositories.principal.insert({ id: ownerId, matrixUserId: '@' + ownerId + ':test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.member.insert({ principalId: ownerId, principalKind: 'human', displayName: ownerId }));
      value(repositories.principal.insert({ id: agentId, matrixUserId: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId, wakeMode: 'selected' }));
      value(repositories.agentName.insert({ name: agentId, requestId: null, instanceKey: null, agentId }));
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

test('fleet enrollment review hydrates the entire roster and selected identities in three indexed queries', async scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) {
    if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement);
  } });
  cleanup(scope, () => database.close());
  database.pragma('foreign_keys = ON');
  await migrateFixture(database);
  const repositories = createRepositories(database);
  database.transaction(() => {
    value(repositories.principal.insert({ id: 'owner', matrixUserId: '@owner:test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
    value(repositories.member.insert({ principalId: 'owner', principalKind: 'human', displayName: 'Owner' }));
    for (let index = 0; index < 100; index++) value(repositories.principal.insert({ id: 'sender-' + index,
      matrixUserId: '@sender-' + index + ':test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
    for (const [requestId, count] of [['one', 1], ['twenty', 20], ['hundred', 100], ['other', 100]] as const) {
      value(repositories.enrollmentRequest.insert({ id: requestId, ownerId: 'owner', fleetKey: requestId, controllerName: 'Computer',
        controllerCredentialHash: 'hash', verificationCode: requestId, claimHash: 'hash', rosterDigest: 'digest', status: 'pending',
        revision: 0, createdAt: 1, expiresAt: 100, decidedByMemberId: null, decidedAt: null }));
      for (let index = 0; index < count; index++) {
        const instanceKey = 'agent-' + String(index).padStart(3, '0');
        value(repositories.enrollmentItem.insert({ requestId, instanceKey, requestedName: requestId + '-' + instanceKey,
          agentId: null, outcome: 'claimed' }));
        value(repositories.fleetPolicy.insertRequested({ requestId, instanceKey }, { wakeMode: 'selected', expectedAgentRevision: null,
          permissions: ['room.agent.invite'], senders: Array.from({ length: 100 }, (_, senderIndex) => ({ principalId: 'sender-' + senderIndex, includeAgents: senderIndex % 2 === 0 })) }));
      }
    }
  })();
  database.exec('ANALYZE');
  for (const [requestId, count] of [['one', 1], ['twenty', 20], ['hundred', 100]] as const) {
    statements = [];
    const policies = value(repositories.fleetPolicy.requested(requestId));
    assert.equal(policies.length, count);
    assert(policies.every(policy => policy.senders.length === 100 && policy.matrixSenders.length === 100
      && policy.matrixSenders.every(sender => sender.matrixUserId.startsWith('@sender-'))
      && policy.senders.filter(sender => sender.includeAgents).length === 50
      && policy.matrixSenders.filter(sender => sender.includeAgents).length === 50
      && policy.permissions.length === 1 && policy.permissions[0] === 'room.agent.invite'));
    assert.equal(statements.length, 3, 'Policy, permission and selected-sender queries are roster-wide');
    for (const statement of statements) {
      const plan = (database.prepare('EXPLAIN QUERY PLAN ' + statement).all() as { detail: string }[]).map(row => row.detail).join('\n');
      assert.match(plan, /SEARCH .*request_id=/u);
      assert(!plan.includes('SCAN '), 'Fleet policy hydration must seek request indexes, not scan policy or principal tables');
    }
    scope.diagnostic(JSON.stringify({ requestId, instances: count, sendersPerInstance: 100, statements: statements.length }));
  }
  statements = [];
  assert.deepEqual(value(repositories.fleetPolicy.requested('missing')), []);
  assert.equal(statements.length, 1);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});
