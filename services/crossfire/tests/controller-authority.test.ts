import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contractRelease } from './support/release.js';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { readAgent } from '@ctlflow/crossfire-domain/agent/read-agent';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { changeFleetDelivery, reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { recordNativeStop, retirementEligible } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { archiveFleet, removeFleetAgent } from '@ctlflow/crossfire-domain/fleet/retire';
import { createPublication } from '@ctlflow/crossfire-domain/publication/create';
import { reportRuntime } from '@ctlflow/crossfire-domain/runtime/observations';
import { createDecision, answerDecision, receiptDecision } from '@ctlflow/crossfire-domain/runtime/decisions';
import { createWakeRule } from '@ctlflow/crossfire-domain/wake-up/manage';
import { claimWake, acknowledgeWake } from '@ctlflow/crossfire-domain/wake-up/delivery';
import { createFleetMessage, acknowledgeFleetMessage } from '@ctlflow/crossfire-domain/fleet/message';
import { requestFleetRuntime, claimFleetRuntime, receiptFleetRuntime } from '@ctlflow/crossfire-domain/fleet/runtime';
import { heartbeat, enrollment } from '@ctlflow/crossfire-contracts/schema/request';
import { observation, decisionCreation } from '@ctlflow/crossfire-contracts/runtime';

type Fixture = Awaited<ReturnType<typeof applicationFixture>>;
type Agent = Awaited<ReturnType<Fixture['agent']>>;
function beat(fixture: Fixture, agent: Agent, runId: string, stopped = false) {
  return reportListener(fixture.services, agent.actor, agent.id, runId,
    { release: 'proof', messagesDelivered: 0, stopped, controller: agent.controller, statistics: null }, 'proof');
}
function native(fixture: Fixture, agent: Agent, runId: string, state: 'sleeping' | 'working') {
  return reportRuntime(fixture.services, agent.actor, agent.id, runId, { sessionId: 'native-history', roomId: null,
    runtime: 'codex', state, historyMode: 'shared', maxInputBytes: 65536, lastActivityAt: fixture.now(),
    historyAvailable: true, observedAt: fixture.now(), settings: [], errorMessage: null });
}
const reportBytes = Buffer.from('<p>Report</p>');
const reportManifest = { title: 'Controller-bound report', files: [{ path: 'index.html', mediaType: 'text/html',
  bytes: reportBytes.length, sha256: createHash('sha256').update(reportBytes).digest('hex') }] };

test('exact authenticated controller generations, not fleet metadata or agent tokens, admit listener runs', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'authority');
  const other = await fixture.agent(fixture.admin.actor, 'foreign'), runId = randomUUID();
  const body = { release: 'proof', messagesDelivered: 0, stopped: false, statistics: null, controller: agent.controller };
  for (const proof of [{ ...agent.controller, credential: 'invented' }, other.controller,
    { ...agent.controller, fleetId: other.controller.fleetId }, { ...agent.controller, connectionId: randomUUID() }]) {
    assert.equal(reportListener(fixture.services, agent.actor, agent.id, runId, { ...body, controller: proof }, 'proof').ok, false);
  }
  assert.equal(value(fixture.services.repositories.listenerRun.find({ id: runId })), null);
  const { controller: _controller, ...withoutController } = body;
  assert.equal(heartbeat(withoutController).ok, false);
  assert.equal(heartbeat({ ...withoutController, controllerBound: true }).ok, false);
  assert.equal(enrollment({ enrollmentId: randomUUID(), claimSecret: 'a'.repeat(64), ownerMatrixId: fixture.admin.member.principal.matrixUserId,
    fleetKey: null, instances: [{ instanceKey: 'independent', name: 'independent' }] }).ok, false);
  value(beat(fixture, agent, runId));
  const stored = value(fixture.services.repositories.listenerRun.find({ id: runId }))!;
  assert.equal(stored.controller!.fleetId, agent.controller.fleetId);
  assert.equal('credential' in stored.controller!, false);
  const projected = value(readAgent(fixture.services, fixture.admin.actor, agent.id));
  assert.equal(projected.deployment.fleetId, agent.controller.fleetId);
  assert.equal(JSON.stringify(projected).includes(agent.controller.credential), false);
  fixture.advance(30001);
  assert.equal(beat(fixture, agent, randomUUID()).ok, false);
  assert.equal(value(beat(fixture, agent, runId)).disconnect, true);
  fixture.renewController(agent.controller);
  assert.equal(beat(fixture, agent, runId).ok, false, 'A run cannot adopt a replacement controller generation');
  value(beat(fixture, agent, randomUUID()));
  const events = value(fixture.services.collection.audits({ page: 1, pageSize: 100 })).items;
  assert.equal(JSON.stringify(events).includes(agent.controller.credential), false);
});

test('publication admission follows the current bound run, fleet intent and live controller lease', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publication-authority');
  const publish = () => createPublication(fixture.services, agent.actor, reportManifest, randomUUID());
  assert.equal(publish().ok, false, 'Ordinary enrolled account authority alone is insufficient');
  const first = fixture.listen(agent);
  value(publish());
  const fleet = value(fixture.services.repositories.fleet.findById(agent.controller.fleetId))!;
  const pause = value(changeFleetDelivery(fixture.services, fixture.admin.actor, fleet.id, { expectedRevision: fleet.revision, enabled: false }, randomUUID()));
  assert.equal(publish().ok, false);
  value(changeFleetDelivery(fixture.services, fixture.admin.actor, fleet.id, { expectedRevision: pause.revision, enabled: true }, randomUUID()));
  value(publish());
  fixture.advance(30001);
  assert.equal(publish().ok, false);
  fixture.renewController(agent.controller);
  assert.equal(publish().ok, false, 'A live lease cannot authorize a run bound to the old connection');
  const current = fixture.listen(agent);
  assert.notEqual(current.runId, first.runId);
  value(publish());
  value(reportListener(fixture.services, agent.actor, agent.id, current.runId,
    { release: 'test', messagesDelivered: 0, stopped: true, controller: agent.controller, statistics: null }, 'test'));
  assert.equal(publish().ok, false);
});

test('retirement requires the latest manually stopped receiver and immutable actual native-close evidence', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'retirement');
  const fleetId = agent.controller.fleetId, controller = value(authenticateController(fixture.services, agent.controller.credential));
  const eligible = () => value(retirementEligible(fixture.services, fleetId, agent.id));
  assert.equal(eligible(), true, 'An identity with neither runs nor observed native history has never started');
  const runId = randomUUID(); value(beat(fixture, agent, runId));
  assert.equal(eligible(), false, 'First heartbeat with no observation is not proof of no native execution');
  value(native(fixture, agent, runId, 'sleeping'));
  assert.equal(eligible(), false, 'Idle sleep leaves delivery able to wake the agent');
  const receipt = { connectionId: agent.controller.connectionId, runId, receiptId: randomUUID() };
  assert.equal(recordNativeStop(fixture.services, controller, fleetId, agent.id, receipt).ok, false);
  value(beat(fixture, agent, runId, true));
  assert.equal(eligible(), false, 'A stopped heartbeat never claims that native close completed');
  value(recordNativeStop(fixture.services, controller, fleetId, agent.id, receipt));
  const original = value(fixture.services.repositories.nativeStop.find(agent.id))!;
  fixture.advance(1); value(recordNativeStop(fixture.services, controller, fleetId, agent.id, receipt));
  assert.deepEqual(value(fixture.services.repositories.nativeStop.find(agent.id)), original);
  assert.equal(eligible(), true);
  assert.equal(value(readAgent(fixture.services, fixture.admin.actor, agent.id)).canRetire, true);
  fixture.advance(1); const next = randomUUID(); value(beat(fixture, agent, next));
  assert.equal(eligible(), false, 'A new receiver generation invalidates retirement eligibility immediately');
  assert.equal(recordNativeStop(fixture.services, controller, fleetId, agent.id, receipt).ok, false);
  value(native(fixture, agent, next, 'working'));
  assert.equal(value(fixture.services.repositories.nativeStop.receipt(agent.id, receipt.receiptId))!.invalidatedAt, fixture.now());
  value(beat(fixture, agent, next, true));
  assert.equal(recordNativeStop(fixture.services, controller, fleetId, agent.id, { ...receipt, runId: next }).ok, false);
  value(recordNativeStop(fixture.services, controller, fleetId, agent.id, { ...receipt, runId: next, receiptId: randomUUID() }));
  assert.equal(eligible(), true);
  const fleet = value(fixture.services.repositories.fleet.findById(fleetId))!;
  value(removeFleetAgent(fixture.services, controller, fleetId, agent.id, { expectedRevision: fleet.revision, instanceKey: 'retirement' }, randomUUID()));
  assert.equal(readAgent(fixture.services, fixture.admin.actor, agent.id).ok, false);
  assert.equal(value(fixture.services.directory.agents({ agentIds: [agent.id], page: 1, pageSize: 20, search: '', statuses: ['active', 'suspended', 'revoked'] })).totalItems, 0);
  assert.equal(value(fixture.services.repositories.principal.find({ id: agent.id }))!.status, 'suspended');
  assert(value(fixture.services.repositories.agentCredential.find({ agentId: agent.id })));
  assert.equal(value(fixture.services.repositories.fleetInstance.findByAgent(agent.id))!.retiredAt, fixture.now());
  assert.equal(beat(fixture, agent, randomUUID()).ok, false);
});

test('decisions, scheduled claims, broadcast receipts and session operations settle before native retirement', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, agent = await fixture.agent(admin.actor, 'settlement');
  const runId = randomUUID(), fleetId = agent.controller.fleetId, controller = value(authenticateController(services, agent.controller.credential));
  value(beat(fixture, agent, runId));
  const decision = { id: randomUUID(), runId, runtime: 'codex', sessionId: 'native-history', requestId: 'native-question',
    turnId: 'native-turn', itemId: 'native-item', kind: 'question' as const, action: 'Choose', review: 'Native choice', blocking: true, expiresAt: null,
    questions: [{ id: 'choice', title: 'Choose', prompt: 'Continue?', allowText: false, secret: false,
      options: [{ id: 'yes', label: 'Yes', description: 'Continue the task' }] }] };
  value(createDecision(services, agent.actor, agent.id, decision));
  value(answerDecision(services, admin.actor, agent.id, decision.id, { answers: [{ questionId: 'choice', optionId: 'yes', text: null }] }, randomUUID()));
  const ruleId = randomUUID();
  value(createWakeRule(services, admin.actor, ruleId, { name: 'Wake', message: 'Fetch the report.', schedule: { kind: 'interval', seconds: 1 }, enabled: true, agentIds: [agent.id] }, randomUUID()));
  fixture.advanceConnected(1001, agent.controller);
  const attachment = { runId, sessionId: 'native-history' }, wake = value(claimWake(services, agent.actor, agent.id, attachment))!;
  const broadcast = value(createFleetMessage(services, admin.actor, fleetId, { messageId: randomUUID(), body: 'Explicit task' }, randomUUID()));
  value(beat(fixture, agent, runId, true));
  const stop = { connectionId: agent.controller.connectionId, runId, receiptId: randomUUID() };
  assert.equal(recordNativeStop(services, controller, fleetId, agent.id, stop).ok, false);
  value(receiptDecision(services, agent.actor, agent.id, decision.id, 'cancelled'));
  assert.equal(recordNativeStop(services, controller, fleetId, agent.id, stop).ok, false);
  value(acknowledgeWake(services, agent.actor, agent.id, wake.deliveryId, attachment));
  assert.equal(recordNativeStop(services, controller, fleetId, agent.id, stop).ok, false);
  value(acknowledgeFleetMessage(services, controller, fleetId, broadcast.messageId, agent.id, { status: 'skipped', errorMessage: 'Controller stopped before publication' }));
  value(recordNativeStop(services, controller, fleetId, agent.id, stop));
  const fleet = value(services.repositories.fleet.findById(fleetId))!;
  const operation = value(requestFleetRuntime(services, admin.actor, fleetId, { operationId: randomUUID(), agentId: agent.id,
    action: 'stop', expectedRevision: fleet.revision, confirmFreshHistory: false }, randomUUID()));
  assert.equal(value(retirementEligible(services, fleetId, agent.id)), false);
  value(claimFleetRuntime(services, controller, fleetId, operation.operationId, agent.controller.connectionId));
  value(receiptFleetRuntime(services, controller, fleetId, operation.operationId, { connectionId: agent.controller.connectionId, status: 'succeeded', errorMessage: null }));
  assert.equal(value(retirementEligible(services, fleetId, agent.id)), true);
  const stored = value(services.repositories.nativeStop.receipt(agent.id, operation.operationId))!;
  value(receiptFleetRuntime(services, controller, fleetId, operation.operationId, { connectionId: agent.controller.connectionId, status: 'succeeded', errorMessage: null }));
  assert.deepEqual(value(services.repositories.nativeStop.receipt(agent.id, operation.operationId)), stored);
});

test('REST controller archive requires the exact owned live lease, preserves history and revokes authority', async scope => {
  const fixture = await applicationFixture(scope), http = await httpFixture(scope, fixture.application);
  const owner = await fixture.member('owner'), other = await fixture.member('other');
  const agent = await fixture.agent(owner.actor, 'archive'), foreign = await fixture.agent(other.actor, 'foreign-archive');
  const fleetId = agent.controller.fleetId, fleet = value(fixture.services.repositories.fleet.findById(fleetId))!;
  const path = '/api/fleets/' + fleetId, archive = path + '/archive', input = { expectedRevision: fleet.revision };
  const controllerHeaders = { Authorization: 'Bearer ' + agent.controller.credential };
  assert.equal((await http.request(archive, 'POST', input, { Authorization: 'Bearer ' + agent.token })).status, 401);
  assert.equal((await http.request(archive, 'POST', input, { Authorization: 'Bearer ' + foreign.controller.credential })).status, 403);
  assert.equal((await http.request(archive, 'POST', input, http.headers(other))).status, 403);
  assert.equal((await http.request(archive, 'POST', input, { Cookie: '__Host-crossfire=' + owner.secret })).status, 403);
  assert.equal((await http.request(path, 'DELETE', input, controllerHeaders)).status, 405);
  assert.equal((await http.request(path + '/agents/' + agent.id, 'PUT', { instanceKey: 'archive', expectedRevision: fleet.revision }, controllerHeaders)).status, 405);
  fixture.advance(30001);
  assert.equal((await http.request(archive, 'POST', input, controllerHeaders)).status, 409);
  fixture.renewController(agent.controller);
  const result = await http.request(archive, 'POST', input, controllerHeaders);
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal(value(fixture.services.repositories.fleet.findById(fleetId))!.archivedAt, fixture.now());
  assert(value(fixture.services.repositories.agent.find({ principalId: agent.id })));
  assert(value(fixture.services.repositories.agentCredential.find({ agentId: agent.id })));
  assert(value(fixture.services.repositories.fleetPolicy.approved(agent.id)));
  assert.equal(authenticateController(fixture.services, agent.controller.credential).ok, false);
  assert.equal((await http.request(path, 'GET', undefined, controllerHeaders)).status, 401);
  const controller = value(authenticateController(fixture.services, foreign.controller.credential));
  value(reportFleetConnection(fixture.services, controller, foreign.controller.fleetId, foreign.controller.connectionId, true));
  const foreignFleet = value(fixture.services.repositories.fleet.findById(foreign.controller.fleetId))!;
  assert.equal(archiveFleet(fixture.services, controller, foreignFleet.id, foreignFleet.revision, randomUUID()).ok, false);
});

test('unsupported runtime values are rejected at input contracts and managed HTTP observation boundaries', async scope => {
  const fixture = await applicationFixture(scope), http = await httpFixture(scope, fixture.application), agent = await fixture.agent(fixture.admin.actor, 'native-runtime');
  const runId = randomUUID(), release = contractRelease().manifest.release;
  value(reportListener(fixture.services, agent.actor, agent.id, runId,
    { release, stopped: false, messagesDelivered: 0, controller: agent.controller, statistics: null }, release));
  const input = { sessionId: 'native', roomId: null, state: 'idle', historyMode: 'shared', maxInputBytes: 65536,
    lastActivityAt: fixture.now(), historyAvailable: true, observedAt: fixture.now(), settings: [], errorMessage: null };
  const decision = { id: randomUUID(), runId, sessionId: 'native', requestId: '1', turnId: 'turn', itemId: 'item',
    kind: 'permission', action: 'Continue', review: 'Native permission', blocking: true, expiresAt: null,
    questions: [{ id: 'permission', title: 'Continue', prompt: 'Approve?', secret: false, allowText: false,
      options: [{ id: 'yes', label: 'Yes', description: 'Approve the native request' }] }] };
  assert.equal(observation({ ...input, runtime: 'codex' }).ok, true);
  assert.equal(decisionCreation({ ...decision, runtime: 'codex' }).ok, true);
  assert.equal(observation({ ...input, runtime: 'pi' }).ok, true);
  assert.equal(decisionCreation({ ...decision, runtime: 'pi' }).ok, true);
  for (const runtime of ['claude', 'unknown']) {
    assert.equal(observation({ ...input, runtime }).ok, false);
    assert.equal(decisionCreation({ ...decision, runtime }).ok, false);
    const response = await http.request('/api/agents/' + agent.id + '/listener-runs/' + runId + '/runtime', 'PUT', { ...input, runtime }, { Authorization: 'Bearer ' + agent.token });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(value(fixture.services.runtime.observation(agent.id)), []);
  const reported = await http.request('/api/agents/' + agent.id + '/listener-runs/' + runId + '/runtime', 'PUT', { ...input, runtime: 'pi' }, { Authorization: 'Bearer ' + agent.token });
  assert.equal(reported.status, 200, await reported.clone().text());
  assert.equal(value(fixture.services.runtime.observation(agent.id))[0]?.runtime, 'pi');
  const requested = await http.request('/api/agents/' + agent.id + '/runtime-decisions', 'POST',
    { ...decision, runtime: 'pi', kind: 'question' }, { Authorization: 'Bearer ' + agent.token });
  assert.equal(requested.status, 201, await requested.clone().text());
});
