import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canRetireAgent, retirementEligible, recordNativeStop } from '@ctlflow/crossfire-domain/fleet/native-stop';
import type { RetirementAgent } from '@ctlflow/crossfire-domain/port/listener-read';
import { listAgents, readAgent } from '@ctlflow/crossfire-domain/agent/read-agent';
import { listFleets, listFleetAgents, readFleet } from '@ctlflow/crossfire-domain/fleet/read-fleet';
import { archiveFleet, removeFleetAgent } from '@ctlflow/crossfire-domain/fleet/retire';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { applicationFixture, value } from './support/application.js';
import { mapFleet } from './support/map-fleet.js';

test('one pure retirement predicate requires exact stopped latest-run proof and current controller authority', () => {
  const base: RetirementAgent = { agentId: 'agent', fleetId: 'fleet', ownerActive: true, pendingOperation: false,
    pendingDecision: false, pendingWake: false, pendingBroadcast: false, hasObservedRuntime: true,
    latestRun: { id: 'run', stoppedAt: 10, controller: { fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential' } },
    latestActiveObservationAt: 9, nativeStop: { agentId: 'agent', fleetId: 'fleet', receiptId: 'receipt', sequence: 1,
      runId: 'run', connectionId: 'connection', credentialId: 'credential', nativeStoppedAt: 10, invalidatedAt: null },
    controller: { fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential', lastSeenAt: 9,
      expiresAt: 40, closedAt: null, credential: { id: 'credential', fleetId: 'fleet', revokedAt: null } } };
  assert.equal(canRetireAgent(base, 10), true);
  assert.equal(canRetireAgent(base, 40), false, 'Lease expiry is strict');
  for (const [label, changed] of [
    ['owner inactive', { ...base, ownerActive: false }],
    ['runtime operation', { ...base, pendingOperation: true }],
    ['pending or answered decision', { ...base, pendingDecision: true }],
    ['scheduled receipt', { ...base, pendingWake: true }],
    ['unexpired broadcast', { ...base, pendingBroadcast: true }],
    ['no latest run', { ...base, latestRun: null }],
    ['unstopped receiver', { ...base, latestRun: { ...base.latestRun!, stoppedAt: null } }],
    ['no native proof', { ...base, nativeStop: null }],
    ['invalidated proof', { ...base, nativeStop: { ...base.nativeStop!, invalidatedAt: 11 } }],
    ['foreign agent proof', { ...base, nativeStop: { ...base.nativeStop!, agentId: 'other' } }],
    ['foreign fleet proof', { ...base, nativeStop: { ...base.nativeStop!, fleetId: 'other' } }],
    ['old native run', { ...base, nativeStop: { ...base.nativeStop!, runId: 'older' } }],
    ['wrong native connection', { ...base, nativeStop: { ...base.nativeStop!, connectionId: 'older' } }],
    ['wrong native credential', { ...base, nativeStop: { ...base.nativeStop!, credentialId: 'older' } }],
    ['foreign run fleet', { ...base, latestRun: { ...base.latestRun!, controller: { ...base.latestRun!.controller, fleetId: 'other' } } }],
    ['newer activity', { ...base, latestActiveObservationAt: 11 }],
    ['no lease', { ...base, controller: null }],
    ['closed lease', { ...base, controller: { ...base.controller!, closedAt: 10 } }],
    ['foreign lease', { ...base, controller: { ...base.controller!, fleetId: 'other' } }],
    ['new connection', { ...base, controller: { ...base.controller!, connectionId: 'new' } }],
    ['new credential', { ...base, controller: { ...base.controller!, credentialId: 'new' } }],
    ['no credential', { ...base, controller: { ...base.controller!, credential: null } }],
    ['foreign credential', { ...base, controller: { ...base.controller!, credential: { ...base.controller!.credential!, fleetId: 'other' } } }],
    ['revoked credential', { ...base, controller: { ...base.controller!, credential: { ...base.controller!.credential!, revokedAt: 10 } } }],
  ] satisfies [string, RetirementAgent][]) assert.equal(canRetireAgent(changed, 10), false, label);
  const neverStarted = { ...base, latestRun: null, nativeStop: null, controller: null, hasObservedRuntime: false };
  assert.equal(canRetireAgent(neverStarted, 10), true, 'No engine and no observed history require no invented close proof');
  assert.equal(canRetireAgent({ ...neverStarted, pendingDecision: true }, 10), false);
  assert.equal(canRetireAgent({ ...neverStarted, hasObservedRuntime: true }, 10), false, 'Historical observations are never guessed to be stopped');
  assert.equal(canRetireAgent({ ...neverStarted, latestRun: base.latestRun }, 10), false, 'First receiver registration can precede its first observation');
});

test('hundred-agent management pages and archive use the same single batched retirement read', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const fleet = await mapFleet(services, admin.actor, admin.member.principal.backendUserId, 100);
  let reads = 0;
  const original = services.listenerRead.retirement;
  const observed = { ...services, listenerRead: { ...services.listenerRead, retirement(...parameters: Parameters<typeof original>) {
    reads++; return original(...parameters);
  } } };
  for (const pageSize of [1, 20, 100]) {
    reads = 0;
    const agents = value(listAgents(observed, admin.actor, { page: 1, pageSize, search: '', statuses: ['active'], listener: 'all' }));
    assert.equal(agents.totalItems, 100); assert.equal(agents.items.length, pageSize);
    assert(agents.items.every(agent => agent.canRetire && agent.allowedActions.includes('retire') && agent.deployment.fleetId === fleet.fleet.id));
    assert.equal(reads, 1, 'Agent eligibility is not queried per item');
    reads = 0;
    const members = value(listFleetAgents(observed, admin.actor, fleet.fleet.id, { page: 1, pageSize }));
    assert.equal(members.items.length, pageSize); assert(members.items.every(member => member.agent.canRetire));
    assert.equal(reads, 2, 'One fleet-wide archive read and one page-wide agent read, independent of page size');
  }
  reads = 0;
  const fleets = value(listFleets(observed, admin.actor, { page: 1, pageSize: 100 }));
  assert.equal(fleets.items.length, 1); assert.equal(fleets.items[0]!.canArchive, true); assert.equal(reads, 1);
  reads = 0;
  value(archiveFleet(observed, admin.actor, fleet.fleet.id, fleet.fleet.revision, randomUUID()));
  assert.equal(reads, 1, 'Archive admission rechecks all current members in one transactional batch');
  assert.equal(value(services.directory.agents({ page: 1, pageSize: 100, search: '', statuses: ['active', 'suspended', 'revoked'] })).totalItems, 0);
  assert.equal(value(services.collection.fleetInstances(fleet.fleet)).length, 0, 'Retired members are absent from the operational roster');
  for (const instance of fleet.instances) {
    assert.equal(value(services.repositories.principal.find({ id: instance.agentId! }))!.status, 'suspended');
    assert(value(services.repositories.fleetInstance.findByAgent(instance.agentId!))!.retiredAt);
  }
});

test('projection eligibility is never trusted by retirement after receiver or controller generation changes', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, agent = await fixture.agent(admin.actor, 'retirement-races');
  const fleetId = agent.controller.fleetId, revision = value(readFleet(services, admin.actor, fleetId)).revision;
  const controller = value(authenticateController(services, agent.controller.credential));
  assert.equal(value(readAgent(services, admin.actor, agent.id)).canRetire, true);
  const first = fixture.listen(agent);
  const retire = () => removeFleetAgent(services, admin.actor, fleetId, agent.id, { expectedRevision: revision, instanceKey: 'retirement-races' }, randomUUID());
  assert.equal(retire().ok, false, 'A new receiver between projection and mutation defeats no-engine admission');
  value(reportListener(services, agent.actor, agent.id, first.runId,
    { release: 'test', messagesDelivered: 0, stopped: true, statistics: null, controller: agent.controller }, 'test'));
  const stop = { connectionId: agent.controller.connectionId, runId: first.runId, receiptId: randomUUID() };
  value(recordNativeStop(services, controller, fleetId, agent.id, stop));
  assert.equal(value(readAgent(services, admin.actor, agent.id)).canRetire, true);
  fixture.advance(30001);
  assert.equal(retire().ok, false, 'Offline lease is not proof of native ownership');
  assert.equal(value(readFleet(services, admin.actor, fleetId)).canArchive, false);
  assert.equal(archiveFleet(services, admin.actor, fleetId, revision, randomUUID()).ok, false);
  assert.equal(value(services.repositories.principal.find({ id: agent.id }))!.status, 'active');
  assert.equal(value(services.repositories.fleetInstance.findByAgent(agent.id))!.retiredAt, null);
  assert.equal(value(services.repositories.fleet.findById(fleetId))!.revision, revision, 'Rejected lifecycle mutations roll back');
  fixture.renewController(agent.controller);
  assert.equal(retire().ok, false, 'Fresh live lease does not adopt a prior-generation stop');
  assert.equal(recordNativeStop(services, controller, fleetId, agent.id, stop).ok, false);
  const next = fixture.listen(agent);
  value(reportListener(services, agent.actor, agent.id, next.runId,
    { release: 'test', messagesDelivered: 0, stopped: true, statistics: null, controller: agent.controller }, 'test'));
  value(recordNativeStop(services, controller, fleetId, agent.id, { connectionId: agent.controller.connectionId, runId: next.runId, receiptId: randomUUID() }));
  assert.equal(value(retirementEligible(services, fleetId, agent.id)), true);
  value(reportFleetConnection(services, controller, fleetId, agent.controller.connectionId, true));
  assert.equal(retire().ok, false, 'Explicit connection close invalidates retirement authority');
  fixture.renewController(agent.controller);
  const credential = value(services.repositories.fleetCredential.find({ id: controller.credentialId }))!;
  value(services.repositories.fleetCredential.update({ ...credential, revokedAt: fixture.now() }));
  assert.equal(value(retirementEligible(services, fleetId, agent.id)), false);
});
