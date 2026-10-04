import { defaultCoordinationPolicy } from '@crossfire/contracts/coordination-policy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value, secret } from './support/application.js';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { preflightEnrollment } from '@crossfire/domain/enrollment/preflight';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { previewGrantPlan, applyGrantPlan } from '@crossfire/domain/room-access/grant-plan';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { requestWakeNotice } from '@crossfire/domain/notice/request-notice';
import { publishWakeNotice } from '@crossfire/domain/notice/publish-notice';
import { reportListener } from '@crossfire/domain/listener/report';
import { disconnectListeners } from '@crossfire/domain/listener/disconnect';
import { listAgents } from '@crossfire/domain/agent/read-agent';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { reconcilePrincipal } from '@crossfire/domain/principal/reconcile';
import { failure } from '@crossfire/kernel/result';

test('one enrollment pipeline preserves identity, name reservations, ownership and fleet bindings', async scope => {
  const fixture = await applicationFixture(scope);
  const { services, admin } = fixture;
  const other = await fixture.member('other');
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: admin.member.principal.matrixUserId,
    fleetKey: 'research', controller: { name: 'desktop', metadata: { zone: 'local' } }, instances: [{ instanceKey: 'first', name: 'first', coordinationPolicy: defaultCoordinationPolicy() }, { instanceKey: 'second', name: 'second', coordinationPolicy: defaultCoordinationPolicy() }] };
  value(await preflightEnrollment(services, input));
  const introduced = value(await introduceEnrollment(services, input));
  assert.deepEqual(value(await introduceEnrollment(services, input)), introduced);
  assert.equal(value(services.collection.pendingEnrollmentCount()), 1);
  assert.equal(value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: 'research' })), null, 'An anonymous roster does not reserve a fleet');
  assert.equal((await preflightEnrollment(services, { ...input, ownerMatrixId: other.member.principal.matrixUserId })).ok, false);
  const late = value(await introduceEnrollment(services, { ...input, enrollmentId: randomUUID(), claimSecret: secret(),
    instances: [{ instanceKey: 'first', name: 'first', coordinationPolicy: defaultCoordinationPolicy() }, { instanceKey: 'third', name: 'third', coordinationPolicy: defaultCoordinationPolicy() }] }));
  assert.equal(late.instances[0]?.failureCode, 'name_collision');
  assert.equal(late.instances[1]?.outcome, 'claimed');
  assert.equal(decideEnrollment(services, other.actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()).ok, false);
  value(decideEnrollment(services, admin.actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
  const items = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }));
  for (const item of items) value(await reconcilePrincipal(services, item.agentId!));
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  assert.equal(ready.status, 'ready');
  assert.equal(exchangeEnrollment(services, input.enrollmentId, secret()).ok, false);
  const restored = { ...input, controllerCredential: ready.fleet!.controllerCredential!, enrollmentId: randomUUID(), claimSecret: secret(),
    instances: ready.instances.map(item => ({ instanceKey: item.instanceKey, name: item.name, coordinationPolicy: defaultCoordinationPolicy(), identity: { agentId: item.agentId!, accessToken: item.account!.accessToken } })) };
  value(await preflightEnrollment(services, restored));
  assert.equal(value(await introduceEnrollment(services, restored)).request.status, 'approved');
  assert.equal(value(services.directory.activeAgentCount()), 2);
  assert.equal((await introduceEnrollment(services, { ...input, enrollmentId: randomUUID(), claimSecret: secret() })).ok, false, 'Saved bindings require their private identity proof');
  const migratedBinding = { ...restored, enrollmentId: randomUUID(), claimSecret: secret(), fleetKey: 'alternate' };
  assert.equal((await introduceEnrollment(services, migratedBinding)).ok, false, 'An identity cannot belong to two fleets');
});

test('room invitation capabilities cross owners but never transfer provenance or delegate onward', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const other = await fixture.member('other');
  const inviter = await fixture.agent(admin.actor, 'inviter'), target = await fixture.agent(other.actor, 'target'), stranger = await fixture.agent(admin.actor, 'stranger');
  const room = value(await native.createRoom(admin.member.principal.matrixUserId, 'Coordination')).roomId;
  async function grant(agentId: string) {
    const record = value(services.directory.agent(agentId))!;
    const previous = value(services.repositories.agentRoomGrant.find({ agentId, roomId: room }));
    return { agentId, roomId: room, expectedRevision: record.principal.revision, expectedGeneration: previous?.generation ?? null,
      accessMode: 'reply' as const, powerLevel: null, muted: false };
  }
  value(await changeRoomGrant(services, admin.actor, await grant(inviter.id), randomUUID()));
  value(await reconcileRoomGrant(services, inviter.id, room));
  assert.equal((await changeRoomGrant(services, inviter.actor, await grant(target.id), randomUUID())).ok, false, 'Native invite alone grants no Crossfire delegation');
  const parent = value(services.repositories.agentRoomGrant.find({ agentId: inviter.id, roomId: room }))!;
  value(setRoomPermission(services, admin.actor, { agentId: inviter.id, roomId: room,
    expectedRevision: value(services.directory.agent(inviter.id))!.principal.revision, expectedGeneration: parent.generation, permissions: ['room.agent.invite'] }, randomUUID()));
  value(await changeRoomGrant(services, inviter.actor, await grant(target.id), randomUUID()));
  value(await reconcileRoomGrant(services, target.id, room));
  assert.equal(native.rooms.get(room)!.members.get(target.matrixUserId)?.membership, 'join');
  const assigned = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId: room }))!;
  assert.equal(assigned.addedById, inviter.id);
  assert.equal(assigned.authorizerId, inviter.id);
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: target.id, roomId: room })), []);
  assert.equal(setRoomPermission(services, inviter.actor, { agentId: target.id, roomId: room,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision, expectedGeneration: assigned.generation, permissions: ['room.agent.invite'] }, randomUUID()).ok, false);
  assert.equal((await changeRoomGrant(services, stranger.actor, { ...await grant(target.id), accessMode: 'none' }, randomUUID())).ok, false);
  const duplicate = value(await changeRoomGrant(services, admin.actor, await grant(target.id), randomUUID()));
  assert.equal(duplicate.grant?.addedById, inviter.id, 'Duplicate assignment does not seize the provenance');
  value(await changeRoomGrant(services, inviter.actor, { ...await grant(target.id), accessMode: 'none' }, randomUUID()));
  value(await reconcileRoomGrant(services, target.id, room));
  assert.equal(native.rooms.get(room)!.members.get(target.matrixUserId)?.membership, 'leave');
  const generation = assigned.generation;
  value(await changeRoomGrant(services, admin.actor, await grant(target.id), randomUUID()));
  assert.notEqual(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId: room }))!.generation, generation);
  assert.equal((await changeRoomGrant(services, inviter.actor, { ...await grant(target.id), accessMode: 'none' }, randomUUID())).ok, false, 'A new owner/admin addition cannot be removed by the original inviter');
});

test('bulk room review is complete, revision-bound and atomic', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agents = [await fixture.agent(admin.actor, 'alpha'), await fixture.agent(admin.actor, 'beta')];
  const fleetId = randomUUID();
  value(services.repositories.fleet.insert({ id: fleetId, label: 'Team', controllerName: 'desktop', revision: 0, deliveryEnabled: true, updatedAt: fixture.now(), ownerId: admin.actor.principalId, fleetKey: 'team', createdAt: fixture.now() }));
  for (const [index, agent] of agents.entries()) value(services.repositories.fleetInstance.insert({ ownerId: admin.actor.principalId, fleetKey: 'team', instanceKey: 'worker-' + index, agentId: agent.id }));
  const roomId = value(await fixture.native.createRoom(admin.member.principal.matrixUserId, 'Team')).roomId;
  const plan = { fleetId, agents: agents.map((_agent, index) => ({ instanceKey: 'worker-' + index,
    grants: [{ roomId, accessMode: 'reply' as const, powerLevel: null, muted: false }] })) };
  const preview = value(await previewGrantPlan(services, admin.actor, plan));
  value(changeAgent(services, admin.actor, agents[1]!.id, { expectedRevision: 0, displayName: 'Beta' }, randomUUID()));
  assert.equal((await applyGrantPlan(services, admin.actor, { plan, digest: preview.digest, snapshots: preview.snapshots }, randomUUID())).ok, false);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agents[0]!.id, roomId })), null);
  const revised = value(await previewGrantPlan(services, admin.actor, plan));
  value(await applyGrantPlan(services, admin.actor, { plan, digest: revised.digest, snapshots: revised.snapshots }, randomUUID()));
  for (const agent of agents) assert.equal(value(services.collection.roomGrants({ agentId: agent.id })).length, 1);
});

test('selected wake and explicit blocked mentions use durable sender cooldown without model involvement', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const outsider = await fixture.member('outsider'), receiver = await fixture.agent(admin.actor, 'receiver');
  const roomIds = [value(await native.createRoom(admin.member.principal.matrixUserId, 'First')).roomId,
    value(await native.createRoom(admin.member.principal.matrixUserId, 'Second')).roomId];
  for (const roomId of roomIds) value(await changeRoomGrant(services, admin.actor, { agentId: receiver.id, roomId,
    expectedRevision: value(services.directory.agent(receiver.id))!.principal.revision, expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID()));
  function event(roomId: string, mentions = [receiver.matrixUserId]) {
    const eventId = '$' + randomUUID();
    native.events.set(eventId, { eventId, roomId, senderMatrixId: outsider.member.principal.matrixUserId, type: 'm.room.message',
      messageType: 'm.text', body: 'Hello', mentions, edited: false, control: false });
    return eventId;
  }
  const ignored = event(roomIds[0]!, []);
  assert.equal(value(await requestWakeNotice(services, receiver.actor, receiver.id, roomIds[0]!, ignored)).outcome, 'not-applicable');
  const first = event(roomIds[0]!);
  assert.equal(value(await requestWakeNotice(services, receiver.actor, receiver.id, roomIds[0]!, first)).outcome, 'pending');
  assert.equal(value(await requestWakeNotice(services, receiver.actor, receiver.id, roomIds[1]!, event(roomIds[1]!))).outcome, 'rate-limited');
  native.setNoticeFailure(failure('native', 'Lost response'));
  value(await publishWakeNotice(services, receiver.id, first));
  fixture.advance(600_001);
  native.setNoticeFailure(failure('forbidden', 'Access unavailable after uncertain response'));
  value(await publishWakeNotice(services, receiver.id, first));
  assert.equal(value(services.repositories.wakeNotice.find({ receiverAgentId: receiver.id, eventId: first }))?.status, 'pending', 'Uncertain delivery keeps the original transaction and pair reservation');
  native.setNoticeFailure(null);
  value(await publishWakeNotice(services, receiver.id, first));
  assert.equal(native.notices.size, 1);
  const copy = [...native.notices.values()][0]!.body;
  assert(copy.includes(outsider.member.principal.matrixUserId) && copy.includes(admin.member.member.displayName) && copy.includes(admin.member.principal.matrixUserId));
  value(changeWakePolicy(services, admin.actor, receiver.id, { expectedRevision: value(services.directory.agent(receiver.id))!.principal.revision,
    mode: 'selected', senderIds: [outsider.actor.principalId] }, randomUUID()));
  assert.deepEqual(value(deliveryPolicy(services, receiver.actor, receiver.id)).wake.senders, [outsider.member.principal.matrixUserId]);
  assert.equal(value(await requestWakeNotice(services, receiver.actor, receiver.id, roomIds[0]!, event(roomIds[0]!))).outcome, 'not-applicable');
});

test('listener activity is monotonic, targeted disconnection and owner visibility are exact', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const other = await fixture.member('other'), owned = await fixture.agent(admin.actor, 'owned'), foreign = await fixture.agent(other.actor, 'foreign');
  const runId = randomUUID(), release = '0.1.0-test';
  value(reportListener(services, owned.actor, owned.id, runId, { statistics: null, release, messagesDelivered: 3, controllerBound: false, stopped: false }, release));
  fixture.advance(30_000);
  value(reportListener(services, owned.actor, owned.id, runId, { statistics: null, release, messagesDelivered: 2, controllerBound: false, stopped: false }, release));
  assert.equal(value(services.repositories.listenerRun.find({ id: runId }))?.messagesDelivered, 3);
  assert.equal(value(services.repositories.listenerRun.find({ id: runId }))?.activeMs, 30_000);
  assert.equal(reportListener(services, foreign.actor, owned.id, runId, { statistics: null, release, messagesDelivered: 4, controllerBound: false, stopped: false }, release).ok, false);
  value(disconnectListeners(services, admin.actor, owned.id, { expectedRevision: 0, runIds: [runId] }, randomUUID()));
  const newRun = randomUUID();
  value(reportListener(services, owned.actor, owned.id, newRun, { statistics: null, release, messagesDelivered: 0, controllerBound: false, stopped: false }, release));
  assert.equal(value(reportListener(services, owned.actor, owned.id, runId, { statistics: null, release, messagesDelivered: 3, controllerBound: false, stopped: false }, release)).disconnect, true);
  assert.equal(value(reportListener(services, owned.actor, owned.id, newRun, { statistics: null, release, messagesDelivered: 0, controllerBound: false, stopped: false }, release)).disconnect, false);
  const filter = { page: 1, pageSize: 20, statuses: ['active' as const], search: '', listener: 'all' as const };
  assert.equal(value(listAgents(services, other.actor, filter)).totalItems, 1);
  assert.equal(value(listAgents(services, admin.actor, { ...filter, listener: 'online' })).totalItems, 1);
  assert.equal(value(listAgents(services, admin.actor, { ...filter, listener: 'offline' })).totalItems, 1);
  fixture.advance(90_001);
  assert.equal(value(listAgents(services, admin.actor, { ...filter, listener: 'online' })).totalItems, 0);
});
