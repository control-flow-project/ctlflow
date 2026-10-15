import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { recordNativeStop, retirementEligible } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { requestFleetRuntime, claimFleetRuntime, receiptFleetRuntime } from '@ctlflow/crossfire-domain/fleet/runtime';
import { readFleet } from '@ctlflow/crossfire-domain/fleet/read-fleet';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { reportRuntime } from '@ctlflow/crossfire-domain/runtime/observations';
import { nativeRuntimeSummary, observation } from '@ctlflow/crossfire-contracts/runtime';
import { applicationFixture, value } from './support/application.js';
import { mapFleet } from './support/map-fleet.js';

test('stop completion survives historical runs and lease rollover without fabricating retirement proofs or blocking resume', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const { fleet, instances, controller } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId, 2);
  const actor = value(authenticateController(services, controller.credential)), params = [services, actor, fleet.id] as const;
  const agents = instances.map(instance => instance.agentId!), runs = agents.map(() => randomUUID());
  const lastActivityAt = services.clock.now();
  const report = { release: 'fixture', messagesDelivered: 0, statistics: null, controller, stopped: false };
  for (const [index, agentId] of agents.entries()) {
    value(reportListener(services, { kind: 'agent', principalId: agentId }, agentId, runs[index]!, report, 'fixture'));
    value(reportRuntime(services, { kind: 'agent', principalId: agentId }, agentId, runs[index]!, { sessionId: 'saved-' + index,
      roomId: null, runtime: 'codex', state: 'working', observedAt: services.clock.now(), lastActivityAt: services.clock.now(),
      historyAvailable: true, historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, settings: [] }));
  }
  value(reportListener(services, { kind: 'agent', principalId: agents[0]! }, agents[0]!, runs[0]!, { ...report, stopped: true }, 'fixture'));
  const operation = value(requestFleetRuntime(services, admin.actor, fleet.id, { operationId: randomUUID(), agentId: null,
    action: 'stop', expectedRevision: value(readFleet(services, admin.actor, fleet.id)).revision, confirmFreshHistory: false }, randomUUID()));
  value(claimFleetRuntime(...params, operation.operationId, controller.connectionId));
  value(reportListener(services, { kind: 'agent', principalId: agents[1]! }, agents[1]!, runs[1]!, { ...report, stopped: true }, 'fixture'));
  fixture.advance(30001);
  const next = randomUUID(); value(reportFleetConnection(...params, next, false));
  const outcome = { connectionId: next, status: 'succeeded' as const, errorMessage: null };
  assert.equal(receiptFleetRuntime(...params, operation.operationId, outcome).ok, false, 'Reclaim is mandatory after a lease change');
  value(claimFleetRuntime(...params, operation.operationId, next));
  for (const [index, agentId] of agents.entries()) {
    assert.equal(recordNativeStop(...params, agentId, { connectionId: next, runId: runs[index]!, receiptId: randomUUID() }).ok, false);
  }
  const completed = value(receiptFleetRuntime(...params, operation.operationId, outcome));
  assert.equal(completed.recorded, true);
  const storedOperation = value(services.repositories.fleetRuntimeOperation.find(operation.operationId))!;
  assert.equal(storedOperation.status, 'succeeded'); assert.equal(storedOperation.completedAt, services.clock.now());
  assert.deepEqual(value(receiptFleetRuntime(...params, operation.operationId, outcome)), completed, 'Exact receipt replay is idempotent');
  assert.equal(value(services.repositories.fleetRuntimeOperation.pending(fleet.id)), null);
  assert.equal(value(readFleet(services, admin.actor, fleet.id)).connection.status, 'online');
  const summaries = value(services.runtime.summaries(agents));
  for (const agentId of agents) {
    assert.deepEqual(summaries.get(agentId), { state: 'stopped', observedAt: storedOperation.completedAt, lastActivityAt, historyAvailable: true });
    assert.equal(value(services.repositories.nativeStop.find(agentId)), null);
    assert.equal(value(retirementEligible(services, fleet.id, agentId)), false, 'A lifecycle receipt is not a current-generation retirement proof');
  }
  const resume = value(requestFleetRuntime(services, admin.actor, fleet.id, { operationId: randomUUID(), agentId: null,
    action: 'start', expectedRevision: value(readFleet(services, admin.actor, fleet.id)).revision, confirmFreshHistory: false }, randomUUID()));
  assert.equal(resume.status, 'pending');
});

test('native stopped summaries respect per-agent scope and disappear when a later reporting generation starts', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const { fleet, instances, controller } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId, 2);
  const actor = value(authenticateController(services, controller.credential)), params = [services, actor, fleet.id] as const;
  const agents = instances.map(instance => instance.agentId!), runs = agents.map(() => randomUUID());
  const report = { release: 'fixture', messagesDelivered: 0, statistics: null, controller, stopped: false };
  for (const [index, agentId] of agents.entries()) {
    value(reportListener(services, { kind: 'agent', principalId: agentId }, agentId, runs[index]!, report, 'fixture'));
    value(reportListener(services, { kind: 'agent', principalId: agentId }, agentId, runs[index]!, { ...report, stopped: true }, 'fixture'));
  }
  const operation = value(requestFleetRuntime(services, admin.actor, fleet.id, { operationId: randomUUID(), agentId: agents[0]!,
    action: 'stop', expectedRevision: value(readFleet(services, admin.actor, fleet.id)).revision, confirmFreshHistory: false }, randomUUID()));
  value(claimFleetRuntime(...params, operation.operationId, controller.connectionId));
  value(receiptFleetRuntime(...params, operation.operationId, { connectionId: controller.connectionId, status: 'succeeded', errorMessage: null }));
  const summaries = value(services.runtime.summaries(agents));
  assert.equal(summaries.get(agents[0]!)?.state, 'stopped', 'An initialized model history is not required to confirm a stop');
  assert.equal(summaries.has(agents[1]!), false, 'Stopping one agent cannot confirm another stopped');
  fixture.advance(1);
  const freshRun = randomUUID(), agentId = agents[0]!;
  value(reportListener(services, { kind: 'agent', principalId: agentId }, agentId, freshRun, report, 'fixture'));
  value(reportRuntime(services, { kind: 'agent', principalId: agentId }, agentId, freshRun, { sessionId: 'saved', roomId: null,
    runtime: 'codex', state: 'idle', observedAt: services.clock.now(), lastActivityAt: null, historyAvailable: true,
    historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, settings: [] }));
  assert.equal(value(services.runtime.summaries(agents)).get(agentId)?.state, 'idle');
  value(reportListener(services, { kind: 'agent', principalId: agentId }, agentId, freshRun, { ...report, stopped: true }, 'fixture'));
  const beforeProof = value(services.runtime.summaries(agents)).get(agentId);
  assert.equal(beforeProof?.state, 'idle', 'Closing reporting alone is not a native stop');
  value(recordNativeStop(...params, agentId, { connectionId: controller.connectionId, runId: freshRun, receiptId: randomUUID() }));
  assert.equal(value(services.runtime.summaries(agents)).get(agentId)?.state, 'stopped');
  value(services.repositories.nativeStop.invalidate(agentId, services.clock.now()));
  assert.deepEqual(value(services.runtime.summaries(agents)).get(agentId), beforeProof, 'Invalidated native stop proofs cannot project a confirmed stop');
});

test('Stopped is an authoritative management projection, never a native observation supplied by an agent', () => {
  assert.equal(nativeRuntimeSummary({ state: 'stopped', observedAt: 1, lastActivityAt: null, historyAvailable: true }).ok, true);
  assert.equal(observation({ sessionId: 'saved', roomId: null, runtime: 'codex', state: 'stopped', observedAt: 1,
    lastActivityAt: null, historyAvailable: true, historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, settings: [] }).ok, false);
});
