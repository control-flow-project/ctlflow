import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value, secret } from './support/application.js';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { reconcilePrincipal } from '@crossfire/domain/principal/reconcile';
import { authenticateController } from '@crossfire/domain/fleet/authority';
import { readFleet } from '@crossfire/domain/fleet/read-fleet';
import { removeFleet, bindFleetAgent } from '@crossfire/domain/fleet/change-fleet';
import { reportFleetConnection, changeFleetDelivery } from '@crossfire/domain/fleet/control';
import { createFleetMessage, readFleetControl, listFleetMessages, acknowledgeFleetMessage } from '@crossfire/domain/fleet/message';
import { controlQuery, messagePage, fleetControlSnapshot } from '@crossfire/contracts/fleet-control';
import { failure } from '@crossfire/kernel/result';
import { createFleetChanges } from '../apps/server/src/http/fleet-changes.js';

async function enroll(fixture: Awaited<ReturnType<typeof applicationFixture>>, owner = fixture.admin, name = 'team') {
  const { services } = fixture;
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: owner.member.principal.matrixUserId, fleetKey: name,
    controller: { name: 'desktop' }, instances: [{ instanceKey: 'one', name: name + '-one' }, { instanceKey: 'two', name: name + '-two' }] };
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
  value(await bindFleetAgent(...params, otherId, { expectedRevision: snapshot.revision, instanceKey: 'two', remove: true }, randomUUID()));
  const detached = value(readFleetControl(...params, connectionId));
  assert.deepEqual(detached.agentIds, [agentId]); assert.deepEqual(detached.messages[0]!.agentIds, [otherId], 'Recipient snapshot survives detachment');
  value(acknowledgeFleetMessage(...params, input.messageId, otherId, { status: 'skipped', errorMessage: 'No bound listener' }));
  for (let index = 0; index < 32; index++) value(createFleetMessage(...params, { messageId: randomUUID(), body: 'Queued ' + index }, randomUUID()));
  assert.equal(createFleetMessage(...params, { messageId: randomUUID(), body: 'Queue overflow' }, randomUUID()).ok, false);
  const page = value(listFleetMessages(services, admin.actor, fleet.fleetId, { page: 2, pageSize: 10 }));
  assert.equal(page.totalItems, 33); assert.equal(page.items.length, 10);
  fixture.advance(600001);
  assert.equal(value(listFleetMessages(...params, { page: 1, pageSize: 10 })).items[0]!.expired, 1);
  value(reportFleetConnection(...params, randomUUID(), false));
  assert.equal(value(createFleetMessage(...params, { messageId: randomUUID(), body: 'Fresh task' }, randomUUID())).pending, 1);
  const previousInsert = services.repositories.fleetMessageDelivery.insert;
  services.repositories.fleetMessageDelivery.insert = () => failure('native', 'Synthetic insert failure');
  const failedId = randomUUID();
  assert.equal(createFleetMessage(...params, { messageId: failedId, body: 'Atomic rollback' }, randomUUID()).ok, false);
  services.repositories.fleetMessageDelivery.insert = previousInsert;
  assert.equal(value(services.repositories.fleetMessage.find(failedId)), null);
  const revision = value(readFleet(services, admin.actor, fleet.fleetId)).revision;
  value(removeFleet(services, admin.actor, fleet.fleetId, revision, randomUUID()));
  assert.equal(value(services.repositories.fleetMessage.find(input.messageId)), null);
  assert.equal(value(services.repositories.fleetConnection.find(fleet.fleetId)), null);
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
