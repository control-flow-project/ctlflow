import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value, secret } from './support/application.js';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { readFleet } from '@ctlflow/crossfire-domain/fleet/read-fleet';
import { removeFleetAgent, archiveFleet } from '@ctlflow/crossfire-domain/fleet/retire';
import { reportFleetConnection, changeFleetDelivery } from '@ctlflow/crossfire-domain/fleet/control';
import { createFleetMessage, readFleetControl, listFleetMessages, acknowledgeFleetMessage } from '@ctlflow/crossfire-domain/fleet/message';
import { controlQuery, messagePage, fleetControlSnapshot } from '@ctlflow/crossfire-contracts/fleet-control';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { createFleetChanges } from '../apps/server/src/http/fleet-changes.js';
import { requestFleetRuntime, listFleetRuntime, claimFleetRuntime, receiptFleetRuntime } from '@ctlflow/crossfire-domain/fleet/runtime';
import { runtimeRequest, runtimeOperation, runtimeReceipt } from '@ctlflow/crossfire-contracts/fleet-runtime';

async function enroll(fixture: Awaited<ReturnType<typeof applicationFixture>>, owner = fixture.admin, name = 'team') {
  const { services } = fixture;
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: owner.member.principal.matrixUserId, fleetKey: name,
    controller: { name: 'desktop' }, instances: [{ instanceKey: 'one', name: name + '-one', coordinationPolicy: defaultCoordinationPolicy() }, { instanceKey: 'two', name: name + '-two', coordinationPolicy: defaultCoordinationPolicy() }] };
  const proposed = value(await introduceEnrollment(services, input));
  value(decideEnrollment(services, owner.actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: proposed.request.verificationCode }, randomUUID()));
  for (const item of value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))) value(await reconcilePrincipal(services, item.agentId!));
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret)), fleetId = ready.fleet!.fleetId;
  return { ready, fleetId, controller: value(authenticateController(services, ready.fleet!.controllerCredential!)) };
}

test('exclusive expiring controller generations and scoped delivery intent never mutate agent accounts', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const other = await fixture.member('other'), first = await enroll(fixture), second = await enroll(fixture, other, 'other');
  const connectionId = randomUUID(), params = [services, first.controller, first.fleetId] as const;
  assert.equal(readFleetControl(...params, connectionId).ok, false);
  assert.equal(reportFleetConnection(services, admin.actor, first.fleetId, connectionId, false).ok, false);
  assert.equal(reportFleetConnection(services, first.controller, second.fleetId, connectionId, false).ok, false);
  value(reportFleetConnection(...params, connectionId, false));
  assert.equal(reportFleetConnection(...params, randomUUID(), false).ok, false);
  assert.equal(readFleetControl(...params, randomUUID()).ok, false);
  const revision = value(readFleet(services, admin.actor, first.fleetId)).revision;
  assert.equal(changeFleetDelivery(services, other.actor, first.fleetId, { expectedRevision: revision, enabled: false }, randomUUID()).ok, false);
  const before = first.ready.instances.map(instance => value(services.directory.agent(instance.agentId!)));
  const paused = value(changeFleetDelivery(services, admin.actor, first.fleetId, { expectedRevision: revision, enabled: false }, randomUUID()));
  assert.equal(paused.deliveryEnabled, false);
  assert.equal(value(readFleet(services, admin.actor, first.fleetId)).deliveryEnabled, false);
  assert.equal(value(readFleetControl(...params, connectionId)).deliveryEnabled, false);
  assert.equal(changeFleetDelivery(...params, { expectedRevision: revision, enabled: true }, randomUUID()).ok, false);
  assert.deepEqual(value(readFleetControl(...params, connectionId)).messages, []);
  value(changeFleetDelivery(...params, { expectedRevision: paused.revision, enabled: true }, randomUUID()));
  assert.deepEqual(first.ready.instances.map(instance => value(services.directory.agent(instance.agentId!))), before);
  fixture.advance(30001);
  assert.equal(value(readFleet(services, admin.actor, first.fleetId)).connection.status, 'offline');
  assert.equal(reportFleetConnection(...params, connectionId, false).ok, false);
  assert.equal(readFleetControl(...params, connectionId).ok, false);
  const fresh = randomUUID(); value(reportFleetConnection(...params, fresh, false)); value(reportFleetConnection(...params, fresh, true));
  assert.equal(reportFleetConnection(...params, fresh, false).ok, false);
});

test('fleet messages are durable, roster-snapshotted, bounded, idempotent and receipt-authorized', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, fleet = await enroll(fixture);
  const connectionId = randomUUID(), params = [services, fleet.controller, fleet.fleetId] as const;
  const input = { messageId: randomUUID(), body: 'An explicit owner task' };
  assert.equal(createFleetMessage(services, admin.actor, fleet.fleetId, input, randomUUID()).ok, false);
  value(reportFleetConnection(...params, connectionId, false));
  const created = value(createFleetMessage(services, admin.actor, fleet.fleetId, input, randomUUID()));
  assert.equal(created.total, 2); assert.equal(created.pending, 2);
  assert.deepEqual(value(createFleetMessage(services, admin.actor, fleet.fleetId, input, randomUUID())), created);
  assert.equal(createFleetMessage(...params, input, randomUUID()).ok, false, 'An idempotency key cannot change authors');
  const agentId = fleet.ready.instances[0]!.agentId!, otherId = fleet.ready.instances[1]!.agentId!;
  assert.equal(createFleetMessage(services, { principalId: agentId, kind: 'agent' }, fleet.fleetId, { ...input, messageId: randomUUID() }, randomUUID()).ok, false);
  const snapshot = value(readFleetControl(...params, connectionId)); assert(fleetControlSnapshot(snapshot).ok);
  assert.deepEqual(snapshot.messages[0]!.sender, { kind: 'human', matrixUserId: admin.member.principal.matrixUserId });
  const delivered = { status: 'delivered' as const, errorMessage: null };
  assert.equal(acknowledgeFleetMessage(services, admin.actor, fleet.fleetId, input.messageId, agentId, delivered).ok, false);
  value(acknowledgeFleetMessage(...params, input.messageId, agentId, delivered));
  value(acknowledgeFleetMessage(...params, input.messageId, agentId, delivered));
  assert.equal(acknowledgeFleetMessage(...params, input.messageId, agentId, { status: 'skipped', errorMessage: 'different' }).ok, false);
  assert.equal(removeFleetAgent(...params, otherId, { expectedRevision: snapshot.revision, instanceKey: 'two' }, randomUUID()).ok, false, 'Pending delivery must settle before retirement');
  value(acknowledgeFleetMessage(...params, input.messageId, otherId, { status: 'skipped', errorMessage: 'Owner stopped this recipient' }));
  value(removeFleetAgent(...params, otherId, { expectedRevision: snapshot.revision, instanceKey: 'two' }, randomUUID()));
  const retired = value(readFleetControl(...params, connectionId));
  assert.deepEqual(retired.agentIds, [agentId]); assert.deepEqual(retired.messages, []);
  assert.equal(value(services.repositories.fleetMessageDelivery.find(input.messageId, otherId))?.status, 'skipped', 'Recipient snapshot survives retirement');
  for (let index = 0; index < 32; index++) {
    fixture.advance(1);
    value(createFleetMessage(...params, { messageId: randomUUID(), body: 'Queued ' + index }, randomUUID()));
  }
  assert.equal(createFleetMessage(...params, { messageId: randomUUID(), body: 'Queue overflow' }, randomUUID()).ok, false);
  const page = value(listFleetMessages(services, admin.actor, fleet.fleetId, { page: 2, pageSize: 10 }));
  assert.equal(page.totalItems, 33); assert.equal(page.items.length, 10);
  fixture.advance(600001);
  assert.equal(value(listFleetMessages(...params, { page: 1, pageSize: 10 })).items[0]!.expired, 1);
  value(reportFleetConnection(...params, randomUUID(), false));
  const freshId = randomUUID();
  assert.equal(value(createFleetMessage(...params, { messageId: freshId, body: 'Fresh task' }, randomUUID())).pending, 1);
  const previousInsert = services.repositories.fleetMessageDelivery.insert;
  services.repositories.fleetMessageDelivery.insert = () => failure('native', 'Synthetic insert failure');
  const failedId = randomUUID();
  assert.equal(createFleetMessage(...params, { messageId: failedId, body: 'Atomic rollback' }, randomUUID()).ok, false);
  services.repositories.fleetMessageDelivery.insert = previousInsert;
  assert.equal(value(services.repositories.fleetMessage.find(failedId)), null);
  const revision = value(readFleet(services, admin.actor, fleet.fleetId)).revision;
  assert.equal(archiveFleet(services, admin.actor, fleet.fleetId, revision, randomUUID()).ok, false, 'Archive cannot discard unsettled receipts');
  value(acknowledgeFleetMessage(...params, freshId, agentId, { status: 'skipped', errorMessage: 'Stopped before archive' }));
  value(archiveFleet(...params, revision, randomUUID()));
  assert(value(services.repositories.fleetMessage.find(input.messageId)));
  assert(value(services.repositories.fleetConnection.find(fleet.fleetId))?.closedAt);
  assert.equal(authenticateController(services, fleet.ready.fleet!.controllerCredential!).ok, false);
});

test('controller queries refuse coercion, duplicated fields and inconsistent snapshots', () => {
  const valid = { connectionId: randomUUID(), revision: '0', waitMs: '10000' };
  assert(controlQuery(new URLSearchParams(valid)).ok);
  for (const field of ['revision', 'waitMs']) for (const value of ['', '1e2', '01', ' 2', '-1', 'Infinity']) {
    assert.equal(controlQuery(new URLSearchParams({ ...valid, [field]: value })).ok, false);
  }
  for (const pageSize of ['11', '', '1e1', '01']) assert.equal(messagePage(new URLSearchParams({ pageSize })).ok, false);
  const duplicate = new URLSearchParams(valid); duplicate.append('connectionId', valid.connectionId); assert.equal(controlQuery(duplicate).ok, false);
  const agentId = randomUUID();
  assert.equal(fleetControlSnapshot({ fleetId: randomUUID(), revision: 0, deliveryEnabled: true, connection: { status: 'online', lastSeenAt: 1 }, agentIds: [agentId, agentId], messages: [] }).ok, false);
});

test('controller long polls retain notifications and release their owner on timeout or disconnect', async () => {
  const changes = createFleetChanges(), fleetId = randomUUID(), stop = new AbortController();
  const revision = changes.version(fleetId);
  changes.notify(fleetId);
  assert.equal((await changes.wait(fleetId, revision, 10000, stop.signal)).ok, true);
  const waiting = changes.wait(fleetId, changes.version(fleetId), 10000, stop.signal);
  assert.equal((await changes.wait(fleetId, changes.version(fleetId), 10000, stop.signal)).ok, false);
  changes.notify(fleetId); assert.equal((await waiting).ok, true);
  const cancelled = changes.wait(fleetId, changes.version(fleetId), 10000, stop.signal);
  stop.abort(); assert.equal((await cancelled).ok, false);
  assert.equal((await changes.wait(fleetId, changes.version(fleetId), 1, new AbortController().signal)).ok, true);
});

test('session requests are human-authorized, confirmed, atomic, revision-checked and idempotent across controller generations', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, fleet = await enroll(fixture);
  const stranger = await fixture.member('stranger'), agentId = fleet.ready.instances[0]!.agentId!;
  const params = [services, fleet.controller, fleet.fleetId] as const, connectionId = randomUUID();
  const input = { operationId: randomUUID(), agentId: null, action: 'reset' as const,
    expectedRevision: value(readFleet(services, admin.actor, fleet.fleetId)).revision, confirmFreshHistory: true };
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, input, randomUUID()).ok, false, 'Offline controllers cannot accept lifecycle changes');
  value(reportFleetConnection(...params, connectionId, false));
  for (const actor of [stranger.actor, fleet.controller, { kind: 'agent' as const, principalId: agentId }]) {
    assert.equal(requestFleetRuntime(services, actor, fleet.fleetId, input, randomUUID()).ok, false);
  }
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, confirmFreshHistory: false }, randomUUID()).ok, false);
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, expectedRevision: input.expectedRevision + 1 }, randomUUID()).ok, false);
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, agentId: randomUUID() }, randomUUID()).ok, false);
  const update = services.repositories.fleet.update;
  services.repositories.fleet.update = () => failure('unavailable', 'Synthetic revision persistence failure');
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, input, randomUUID()).ok, false);
  services.repositories.fleet.update = update;
  assert.equal(value(services.repositories.fleetRuntimeOperation.find(input.operationId)), null, 'A failed transaction cannot leave a destructive command');
  const accepted = value(requestFleetRuntime(services, admin.actor, fleet.fleetId, input, randomUUID()));
  assert(runtimeOperation(accepted).ok); assert.equal(accepted.status, 'pending');
  assert.deepEqual(value(requestFleetRuntime(services, admin.actor, fleet.fleetId, input, randomUUID())), accepted);
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, action: 'start', confirmFreshHistory: false }, randomUUID()).ok, false);
  const revision = value(readFleet(services, admin.actor, fleet.fleetId)).revision;
  assert.equal(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, operationId: randomUUID(), expectedRevision: revision }, randomUUID()).ok, false);
  assert.deepEqual(value(readFleetControl(...params, connectionId)).runtimeOperations, [accepted]);
  const outcome = { connectionId, status: 'succeeded' as const, errorMessage: null };
  assert.equal(receiptFleetRuntime(...params, input.operationId, outcome).ok, false, 'Publication requires a claimed native operation');
  assert.equal(claimFleetRuntime(services, admin.actor, fleet.fleetId, input.operationId, connectionId).ok, false);
  assert.equal(claimFleetRuntime(...params, input.operationId, randomUUID()).ok, false);
  const claimed = value(claimFleetRuntime(...params, input.operationId, connectionId)); assert.equal(claimed.status, 'running');
  value(changeFleetDelivery(services, admin.actor, fleet.fleetId, { expectedRevision: revision, enabled: false }, randomUUID()));
  assert.equal(value(readFleetControl(...params, connectionId)).runtimeOperations[0]!.operationId, input.operationId, 'Paused delivery does not disable session control');
  fixture.advance(30001);
  const next = randomUUID(); value(reportFleetConnection(...params, next, false));
  assert.equal(receiptFleetRuntime(...params, input.operationId, outcome).ok, false, 'An old connection cannot report a native result');
  assert.equal(receiptFleetRuntime(...params, input.operationId, { ...outcome, connectionId: next }).ok, false, 'A new connection must reclaim the same operation');
  assert.equal(value(claimFleetRuntime(...params, input.operationId, next)).operationId, input.operationId);
  value(receiptFleetRuntime(...params, input.operationId, { ...outcome, connectionId: next }));
  value(receiptFleetRuntime(...params, input.operationId, { ...outcome, connectionId: next }));
  assert.equal(receiptFleetRuntime(...params, input.operationId, { connectionId: next, status: 'failed', errorMessage: 'Different outcome' }).ok, false);
  assert.deepEqual(value(readFleetControl(...params, next)).runtimeOperations, []);
  const page = value(listFleetRuntime(services, admin.actor, fleet.fleetId, { page: 1, pageSize: 10 }));
  assert.equal(page.totalItems, 1); assert.equal(page.items[0]!.status, 'succeeded');
  const currentRevision = value(readFleet(services, admin.actor, fleet.fleetId)).revision;
  const perAgent = value(requestFleetRuntime(services, admin.actor, fleet.fleetId, { ...input, operationId: randomUUID(), agentId,
    action: 'start', confirmFreshHistory: false, expectedRevision: currentRevision }, randomUUID()));
  assert.equal(perAgent.agentId, agentId);
  assert.equal(value(readFleetControl(...params, next)).runtimeOperations[0]!.operationId, perAgent.operationId);
});

test('session admission rechecks changed revisions and human authority before any native operation can execute', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, owner = await fixture.member('session-owner');
  const fleet = await enroll(fixture, owner, 'sessions'), params = [services, fleet.controller, fleet.fleetId] as const;
  const connectionId = randomUUID(); value(reportFleetConnection(...params, connectionId, false));
  const create = () => value(requestFleetRuntime(services, owner.actor, fleet.fleetId, { operationId: randomUUID(), agentId: null, action: 'start',
    confirmFreshHistory: false, expectedRevision: value(readFleet(services, owner.actor, fleet.fleetId)).revision }, randomUUID()));
  const stale = create();
  value(changeFleetDelivery(services, owner.actor, fleet.fleetId, { expectedRevision: stale.expectedRevision + 1, enabled: false }, randomUUID()));
  assert.equal(value(claimFleetRuntime(...params, stale.operationId, connectionId)).status, 'failed');
  const request = value(requestFleetRuntime(services, admin.actor, fleet.fleetId, { operationId: randomUUID(), agentId: null, action: 'stop', confirmFreshHistory: false,
    expectedRevision: value(readFleet(services, admin.actor, fleet.fleetId)).revision }, randomUUID()));
  const permissions = services.directory.permissions;
  services.directory.permissions = () => failure('unavailable', 'Synthetic authority storage failure');
  assert.equal(claimFleetRuntime(...params, request.operationId, connectionId).ok, false);
  assert.equal(value(services.repositories.fleetRuntimeOperation.pending(fleet.fleetId))?.status, 'pending', 'Storage uncertainty cannot permanently reject a queued command');
  services.directory.permissions = permissions;
  const principal = value(services.repositories.principal.find({ id: admin.actor.principalId }))!;
  value(services.repositories.principal.update({ ...principal, status: 'suspended', revision: principal.revision + 1 }));
  const denied = value(claimFleetRuntime(...params, request.operationId, connectionId));
  assert.equal(denied.status, 'failed'); assert(denied.errorMessage?.includes('authority'));
  assert.equal(value(services.repositories.fleetRuntimeOperation.pending(fleet.fleetId)), null);
});

test('session API validators reject ambiguous destructive intent and inconsistent native receipts', () => {
  const request = { operationId: randomUUID(), agentId: null, action: 'start', expectedRevision: 0, confirmFreshHistory: false };
  assert(runtimeRequest(request).ok);
  for (const input of [{ ...request, confirmFreshHistory: true }, { ...request, action: 'reset' }, { ...request, extra: true }, { ...request, action: 'resume' }]) assert.equal(runtimeRequest(input).ok, false);
  assert.equal(runtimeReceipt({ connectionId: randomUUID(), status: 'succeeded', errorMessage: 'Untrue success' }).ok, false);
  assert.equal(runtimeReceipt({ connectionId: randomUUID(), status: 'failed', errorMessage: null }).ok, false);
});
