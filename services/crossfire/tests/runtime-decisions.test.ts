import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value } from './support/application.js';
import { reportListener } from '@crossfire/domain/listener/report';
import { createDecision, readDecision, answerDecision, pollDecision, receiptDecision, expireDecisions, listDecisions } from '@crossfire/domain/runtime/decisions';
import { reportRuntime } from '@crossfire/domain/runtime/observations';
import { reconcileRuntime, openIncident } from '@crossfire/domain/runtime/incidents';
import type { DecisionCreation } from '@crossfire/contracts/runtime';
import { listRooms, readRoom } from '@crossfire/domain/room/read-room';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { acceptRoomInvitation } from '@crossfire/domain/room-access/accept-invitation';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';

async function fixture(scope: Parameters<typeof applicationFixture>[0]) {
  const fixture = await applicationFixture(scope), owner = await fixture.member('owner'), stranger = await fixture.member('stranger');
  const agent = await fixture.agent(owner.actor, 'ada'), runId = randomUUID();
  value(reportListener(fixture.services, agent.actor, agent.id, runId, { release: 'fixture', stopped: false, controllerBound: false, messagesDelivered: 0 }, 'fixture'));
  const request: DecisionCreation = { id: randomUUID(), runId, runtime: 'codex', sessionId: randomUUID(), requestId: '42', turnId: 'turn-original', itemId: 'item-original',
    kind: 'question', action: 'Choose a destination', review: 'Exact native review', blocking: true, expiresAt: null,
    questions: [{ id: 'destination', title: 'Destination', prompt: 'Select one', allowText: true, secret: true,
      options: [{ id: '0', label: 'A', description: 'Original native option' }, { id: '1', label: 'B', description: 'Second native option' }] }] };
  return { ...fixture, owner, stranger, agent, runId, request };
}

test('native decisions are immutable, owner-only, complete, one-shot and private until receipt', async scope => {
  const fixture_ = await fixture(scope), { services, owner, stranger, agent, request } = fixture_;
  value(createDecision(services, agent.actor, agent.id, request));
  value(createDecision(services, agent.actor, agent.id, { ...request }));
  assert.equal(createDecision(services, agent.actor, agent.id, { ...request, itemId: 'different-item' }).ok, false);
  const input = { answers: [{ questionId: 'destination', optionId: null, text: 'private-answer' }] };
  for (const actor of [stranger.actor, fixture_.admin.actor, agent.actor]) assert.equal(answerDecision(services, actor, agent.id, request.id, input, randomUUID()).ok, false);
  assert.equal(answerDecision(services, owner.actor, agent.id, request.id, { answers: [{ questionId: 'destination', optionId: 'missing', text: null }] }, randomUUID()).ok, false);
  value(answerDecision(services, owner.actor, agent.id, request.id, input, randomUUID()));
  assert.equal(answerDecision(services, owner.actor, agent.id, request.id, input, randomUUID()).ok, false);
  assert.equal(JSON.stringify(value(readDecision(services, owner.actor, agent.id, request.id))).includes('private-answer'), false);
  assert.deepEqual(value(pollDecision(services, agent.actor, agent.id, request.id)).answers, input.answers);
  value(receiptDecision(services, agent.actor, agent.id, request.id, 'responded'));
  assert.equal(value(readDecision(services, owner.actor, agent.id, request.id)).status, 'responded');
  assert.deepEqual(value(services.runtime.answers(request.id)), []);
  assert.equal(receiptDecision(services, agent.actor, agent.id, request.id, 'cancelled').ok, false);
});

test('decision GET derives expiry without changing storage and maintenance erases expired private answers', async scope => {
  const { services, owner, agent, request, advance } = await fixture(scope);
  value(createDecision(services, agent.actor, agent.id, { ...request, expiresAt: services.clock.now() + 1000 }));
  value(answerDecision(services, owner.actor, agent.id, request.id, { answers: [{ questionId: 'destination', optionId: null, text: 'secret' }] }, randomUUID()));
  advance(1001);
  assert.equal(value(readDecision(services, owner.actor, agent.id, request.id)).status, 'expired');
  assert.equal(value(services.runtime.decision(request.id))!.status, 'answered');
  value(expireDecisions(services));
  assert.deepEqual(value(services.runtime.answers(request.id)), []);
  assert.equal(value(services.runtime.decision(request.id))!.status, 'expired');
});

test('large native reviews are independent of chat size and lists project only paginated metadata', async scope => {
  const { services, owner, agent, request } = await fixture(scope);
  const review = 'evidence\n'.repeat(10000);
  value(createDecision(services, agent.actor, agent.id, { ...request, review }));
  assert.equal(value(readDecision(services, owner.actor, agent.id, request.id)).review, review);
  const list = value(listDecisions(services, owner.actor, agent.id, { page: 1, pageSize: 1 }));
  assert.equal(list.totalItems, 1); assert.equal('review' in list.items[0]!, false); assert.equal('questions' in list.items[0]!, false);
});

test('execution state is per native history, incidents are deduplicated and lazy management DMs are durable', async scope => {
  const fixture_ = await fixture(scope), { services, agent, runId, request, native } = fixture_;
  value(await native.matrix.provision(services.instance.serviceMatrixId, 'fixture-secret', 'fixture'));
  const base = { sessionId: request.sessionId, roomId: null, runtime: 'codex', historyMode: 'per-room' as const, maxInputBytes: 100000,
    observedAt: services.clock.now(), settings: [{ name: 'model', configured: 'fixture-model', effective: 'fixture-model' }], errorMessage: null };
  value(reportRuntime(services, agent.actor, agent.id, runId, { ...base, state: 'idle' }));
  assert.deepEqual(value(services.runtime.activeIncidents()), []);
  value(reportRuntime(services, agent.actor, agent.id, runId, { ...base, state: 'failed', errorMessage: 'native failure' }));
  value(reportRuntime(services, agent.actor, agent.id, runId, { ...base, state: 'failed', errorMessage: 'native failure' }));
  assert.equal(value(services.runtime.activeIncidents()).length, 1);
  value(reportRuntime(services, agent.actor, agent.id, runId, { ...base, sessionId: 'other-history', state: 'idle' }));
  assert.equal(value(services.runtime.activeIncidents()).length, 1, 'Another room cannot recover the failed history');
  value(await reconcileRuntime(services, () => false));
  value(await reconcileRuntime(services, () => false));
  assert.equal(native.notices.size, 1);
  const conversation = value(services.runtime.conversation(fixture_.owner.actor.principalId)); assert(conversation);
  value(reportRuntime(services, agent.actor, agent.id, runId, { ...base, state: 'idle' }));
  value(await reconcileRuntime(services, () => false));
  assert.equal(native.notices.size, 2);
  assert.equal(value(services.runtime.conversation(fixture_.owner.actor.principalId))!.roomId, conversation.roomId);
});

test('idle heartbeat recovery restores contact without declaring a failed native history recovered', async scope => {
  const { services, agent, runId, owner, advance } = await fixture(scope);
  value(openIncident(services, { ownerId: owner.actor.principalId, agentId: agent.id, fleetId: null, runId,
    sessionId: 'failed-history', kind: 'failure', message: 'Original failure' }));
  advance(90001); value(await reconcileRuntime(services, () => false));
  assert.deepEqual(value(services.runtime.activeIncidents()).map(incident => incident.kind).sort(), ['contact', 'failure']);
  value(reportListener(services, agent.actor, agent.id, runId, { release: 'fixture', stopped: false, controllerBound: false, messagesDelivered: 0 }, 'fixture'));
  value(await reconcileRuntime(services, () => false));
  assert.deepEqual(value(services.runtime.activeIncidents()).map(incident => incident.kind), ['failure']);
  assert.equal(value(services.runtime.notifications(services.clock.now())).filter(notice => notice.phase === 'recovery').length, 1);
});

test('a newer intentional stop suppresses false lost-contact notices from an older abandoned run', async scope => {
  const { services, agent, advance } = await fixture(scope);
  advance(1); const next = randomUUID();
  value(reportListener(services, agent.actor, agent.id, next, { release: 'fixture', stopped: false, controllerBound: false, messagesDelivered: 0 }, 'fixture'));
  value(reportListener(services, agent.actor, agent.id, next, { release: 'fixture', stopped: true, controllerBound: false, messagesDelivered: 0 }, 'fixture'));
  advance(90001); value(await reconcileRuntime(services, () => false));
  assert.deepEqual(value(services.runtime.activeIncidents()), []);
});

test('management DMs cannot admit agents through discovery, grants, invitations or direct storage', async scope => {
  const { services, native, owner, admin, agent, runId } = await fixture(scope);
  value(await native.matrix.provision(services.instance.serviceMatrixId, 'fixture-secret', 'fixture'));
  value(openIncident(services, { ownerId: owner.actor.principalId, agentId: agent.id, fleetId: null, runId,
    sessionId: null, kind: 'failure', message: 'Native execution stopped' }));
  value(await reconcileRuntime(services, () => false));
  const conversation = value(services.runtime.conversation(owner.actor.principalId))!;
  assert.equal(value(await listRooms(services, owner.actor, { agentId: agent.id, search: '', page: 1, pageSize: 20 })).items.length, 0);
  assert.equal(value(await listRooms(services, owner.actor, { search: '', page: 1, pageSize: 20 })).items[0]?.roomId, conversation.roomId);
  for (const actor of [owner.actor, admin.actor, agent.actor]) {
    assert.equal((await readRoom(services, actor, conversation.roomId, agent.id)).ok, false);
    assert.equal((await changeRoomGrant(services, actor, { agentId: agent.id, roomId: conversation.roomId,
      expectedRevision: value(services.directory.agent(agent.id))!.principal.revision, expectedGeneration: null,
      accessMode: 'reply', powerLevel: null, muted: false }, randomUUID())).ok, false);
    assert.equal(setRoomPermission(services, actor, { agentId: agent.id, roomId: conversation.roomId,
      expectedRevision: value(services.directory.agent(agent.id))!.principal.revision, expectedGeneration: 'missing', permissions: ['room.agent.invite'] }, randomUUID()).ok, false);
  }
  const grant = { agentId: agent.id, roomId: conversation.roomId, generation: 'invalid-management-grant', authorizerId: owner.actor.principalId,
    addedById: owner.actor.principalId, invitationEventId: null, admissionKind: 'managed' as const, accessMode: 'reply' as const,
    powerLevel: null, muted: false, revision: 0, accessRevision: 0, updatedAt: services.clock.now() };
  assert.equal(services.repositories.agentRoomGrant.insert(grant).ok, false);
  value(services.repositories.agentRoomGrant.insert({ ...grant, accessMode: 'none' }));
  assert.equal(services.repositories.agentRoomGrant.update(grant).ok, false);
  assert.equal(services.repositories.agentRoomPermission.insert({ agentId: agent.id, roomId: conversation.roomId, generation: grant.generation,
    permissionCode: 'room.agent.invite', grantScope: 'agent_room', grantedByMemberId: owner.actor.principalId, grantedAt: services.clock.now() }).ok, false);
  const ownerMatrixId = value(services.directory.member(owner.actor.principalId))!.principal.matrixUserId;
  native.rooms.get(conversation.roomId)!.members.set(agent.matrixUserId, { matrixUserId: agent.matrixUserId, displayName: 'ada', membership: 'invite', creator: false, powerLevel: 0 });
  native.invitations.set(conversation.roomId + ':' + agent.matrixUserId, { roomId: conversation.roomId, eventId: '$management-invite', senderMatrixId: ownerMatrixId, direct: false });
  assert.equal((await acceptRoomInvitation(services, agent.actor, agent.id, conversation.roomId, randomUUID())).ok, false);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
});
