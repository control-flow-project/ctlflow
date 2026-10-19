import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { API, segment } from '@ctlflow/crossfire-adapter-matrix/protocol';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { createInvitationReader } from '@ctlflow/crossfire-adapter-matrix/room/invitation';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { setRoomPermission } from '@ctlflow/crossfire-domain/room-access/set-permission';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { nativeApplication } from './support/native-application.js';
import { httpFixture } from './support/http.js';
import { value } from './support/application.js';

test('native room and direct-message invitations use the canonical grant authority', { timeout: 180000 }, async scope => {
  const fixture = await nativeApplication(scope), { services, admin } = fixture;
  const owner = await fixture.member('alice'), outsider = await fixture.member('bob');
  const target = await fixture.agent(owner.actor, 'ada'), other = await fixture.agent(outsider.actor, 'jo');
  const http = await httpFixture(scope, fixture.application);
  const ownerId = owner.accepted.account.userId, outsiderId = outsider.accepted.account.userId;
  const native = (token: string, method: string, path: string, input?: unknown) => nativeOk({ base: fixture.native.base, token }, method, API + path, input);
  const create = async (token: string, extra: Record<string, unknown> = {}) => {
    const room = value(await native(token, 'POST', '/createRoom', { name: 'Matter', preset: 'private_chat', ...extra }));
    assert(typeof room.room_id === 'string'); return room.room_id;
  };
  const invite = async (token: string, roomId: string, backendUserId = target.backendUserId) => value(await native(token, 'POST', '/rooms/' + segment(roomId) + '/invite', { user_id: backendUserId }));
  const accept = (roomId: string, agent = target) => http.request('/api/agents/' + agent.id + '/room-invitation-acceptances', 'POST', { roomId }, { Authorization: 'Bearer ' + agent.token });
  const grant = (roomId: string, agentId = target.id) => value(services.repositories.agentRoomGrant.find({ agentId, roomId }));
  const assigned = async (agentId: string, roomId: string) => {
    const principal = value(services.repositories.principal.find({ id: agentId }))!;
    const previous = grant(roomId, agentId);
    value(await changeRoomGrant(services, admin.actor, { agentId, roomId, expectedRevision: principal.revision,
      expectedGeneration: previous?.generation ?? null, accessMode: 'reply', nativeAccess: null, muted: false }, randomUUID()));
    value(await reconcileRoomGrant(services, agentId, roomId));
  };

  await scope.test('an owner invite is pending until acceptance, then grants actual reading and replies', async () => {
    const roomId = await create(owner.token);
    await invite(owner.token, roomId);
    assert.equal(value(services.repositories.ownerConversation.find({ agentId: target.id })), null);
    assert.deepEqual(value(await services.messaging.joined(target.backendUserId)), []);
    assert.equal(grant(roomId), null);
    assert.deepEqual(value(deliveryPolicy(services, target.actor, target.id)).grants, []);
    const proof = value(await services.messaging.invitation(target.backendUserId, roomId));
    assert(proof);
    assert(proof.eventId.startsWith('$'));
    assert.equal(proof.senderBackendUserId, ownerId);
    const response = await accept(roomId);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json() as { data: { accepted: boolean } }).data.accepted, true);
    assert.equal(grant(roomId)?.accessMode, 'reply');
    assert.equal(grant(roomId)?.authorizerId, owner.actor.principalId);
    assert.equal(grant(roomId)?.addedById, owner.actor.principalId);
    assert.equal(grant(roomId)?.invitationEventId, proof.eventId);
    const authority = value(await services.messaging.room(ownerId, roomId));
    assert.equal(authority.canInvite, true);
    assert.equal(authority.permissions.find(permission => permission.action === 'invite')?.allowed, true);
    assert(value(await services.messaging.joined(target.backendUserId)).includes(roomId));
    const deniedReply = await services.messaging.setRoomAccess(ownerId, target.backendUserId, roomId, { accessMode: 'reply', muted: false, nativeAccess: { powerLevel: -1 } }, null);
    assert(!deniedReply.ok);
    assert.equal(deniedReply.error.code, 'invalid');
    assert.equal(value(await services.messaging.membership(ownerId, target.backendUserId, roomId)).nativeAccess?.powerLevel, 0);
    assert(value(deliveryPolicy(services, target.actor, target.id)).grants.some(grant => grant.roomId === roomId));
    const sent = value(await native(target.token, 'PUT', '/rooms/' + segment(roomId) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Receipt from Ada' }));
    assert(typeof sent.event_id === 'string');
    const event = value(await native(owner.token, 'GET', '/rooms/' + segment(roomId) + '/event/' + segment(sent.event_id)));
    assert.equal(event.sender, target.backendUserId);
    const reading = value(await native(target.token, 'GET', '/rooms/' + segment(roomId) + '/messages?dir=b&limit=10'));
    assert(Array.isArray(reading.chunk));
    const before = grant(roomId);
    assert.equal((await accept(roomId)).status, 200);
    assert.deepEqual(grant(roomId), before, 'Repeated observation does not change provenance, revisions or generations');
    value(await reconcileRoomGrant(services, target.id, roomId));
    assert(value(await services.messaging.joined(target.backendUserId)).includes(roomId));
  });

  await scope.test('normal owner-created direct messages admit the same owned identity without a second grant step', async () => {
    const roomId = await create(owner.token, { is_direct: true, invite: [target.backendUserId] });
    const response = await accept(roomId);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(grant(roomId)?.accessMode, 'reply');
    assert.equal(grant(roomId)?.muted, false);
    assert.equal(value(services.repositories.ownerConversation.find({ agentId: target.id }))!.roomId, roomId);
    value(await native(target.token, 'PUT', '/rooms/' + segment(roomId) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Direct reply' }));
    assert.equal(value(services.repositories.agent.find({ principalId: target.id }))?.wakeMode, 'selected');
    assert.deepEqual(value(deliveryPolicy(services, target.actor, target.id)).wake.senders, [ownerId]);
  });

  await scope.test('Element trusted DMs preserve native creator authority and reject impossible restrictions', async () => {
    const roomId = await create(owner.token, { preset: 'trusted_private_chat', is_direct: true, invite: [target.backendUserId] });
    const creation = value(await native(owner.token, 'GET', '/rooms/' + segment(roomId) + '/state/m.room.create'));
    assert.equal(creation.room_version, '12');
    assert(Array.isArray(creation.additional_creators) && creation.additional_creators.includes(target.backendUserId));
    const response = await accept(roomId);
    assert.equal(response.status, 200, await response.clone().text());
    const application = value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))!;
    assert.equal(application.membership, 'join');
    assert.equal(application.nativeAccess?.creator, true);
    assert.equal(application.nativeAccess?.powerLevel, null);
    const nativePowers = value(await native(owner.token, 'GET', '/rooms/' + segment(roomId) + '/state/m.room.power_levels'));
    assert(nativePowers.users === undefined || typeof nativePowers.users === 'object' && nativePowers.users !== null
      && !Array.isArray(nativePowers.users) && !Object.hasOwn(nativePowers.users, target.backendUserId), 'Creator identities cannot be assigned finite native power levels');
    value(await native(target.token, 'PUT', '/rooms/' + segment(roomId) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Trusted direct reply' }));
    const previous = grant(roomId)!;
    for (const mode of ['read', 'custom'] as const) {
      const denied = await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
        expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
        expectedGeneration: previous.generation, accessMode: mode, nativeAccess: mode === 'custom' ? { powerLevel: 25 } : null, muted: false }, randomUUID());
      assert(!denied.ok);
      assert.equal(denied.error.code, 'forbidden');
      assert.deepEqual(grant(roomId), previous);
      assert.equal((await services.messaging.setRoomAccess(ownerId, target.backendUserId, roomId,
        { accessMode: mode, muted: false, nativeAccess: { powerLevel: mode === 'custom' ? 25 : -1 } }, null)).ok, false);
    }
    value(await reconcileRoomGrant(services, target.id, roomId));
    assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))?.nativeAccess?.creator, true);
    value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
      expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
      expectedGeneration: previous.generation, accessMode: 'none', nativeAccess: null, muted: false }, randomUUID()));
    value(await reconcileRoomGrant(services, target.id, roomId));
    assert(!value(await services.messaging.joined(target.backendUserId)).includes(roomId));
    assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))?.nativeAccess?.creator, true);
    assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))?.nativeAccess?.powerLevel, null);
  });

  await scope.test('incremental invitation observation sees new invites after idle reads and concurrent room checks', async () => {
    const first = await create(owner.token), second = await create(owner.token);
    assert.equal(value(await services.messaging.invitation(target.backendUserId, first)), null);
    assert.equal(value(await services.messaging.invitation(target.backendUserId, first)), null);
    await invite(owner.token, first);
    await invite(owner.token, second);
    const proofs = await Promise.all([first, second].map(room => services.messaging.invitation(target.backendUserId, room)));
    assert.deepEqual(proofs.map(proof => value(proof)?.roomId), [first, second]);
    assert.equal((await accept(first)).status, 200);
    assert.equal((await accept(second)).status, 200);
    assert.equal(grant(first)?.accessMode, 'reply');
    assert.equal(grant(second)?.accessMode, 'reply');
  });

  await scope.test('a restarted observer catches up from a homeserver-cached initial sync before returning admission authority', async () => {
    value(await native(target.token, 'GET', '/sync?timeout=0'));
    const roomId = await create(owner.token);
    await invite(owner.token, roomId);
    const reader = createInvitationReader();
    assert.equal(value(await reader({ base: fixture.native.base, token: target.token }, target.backendUserId)).get(roomId), ownerId);
    assert.equal((await accept(roomId)).status, 200);
    assert.equal(grant(roomId)?.accessMode, 'reply');
  });

  await scope.test('unrelated humans and undelegated agents cannot turn a native invite into access', async () => {
    const roomId = await create(outsider.token);
    await invite(outsider.token, roomId);
    assert.equal((await accept(roomId)).status, 404);
    assert.equal(grant(roomId), null);
    assert(!value(await services.messaging.joined(target.backendUserId)).includes(roomId));
    const delegatedRoom = await create(admin.token);
    await assigned(other.id, delegatedRoom);
    await invite(other.token, delegatedRoom);
    assert.equal((await accept(delegatedRoom)).status, 403);
    assert.equal(grant(delegatedRoom), null);
    assert.equal(value(await services.messaging.invitation(target.backendUserId, delegatedRoom))?.senderBackendUserId, other.backendUserId);
  });

  await scope.test('native invitations from administrators and explicitly delegated cross-owner agents retain true provenance', async () => {
    const roomId = await create(admin.token);
    await invite(admin.token, roomId);
    assert.equal((await accept(roomId)).status, 200);
    assert.equal(grant(roomId)?.authorizerId, admin.actor.principalId);
    const delegatedRoom = await create(admin.token);
    await assigned(other.id, delegatedRoom);
    const previous = grant(delegatedRoom, other.id)!;
    value(setRoomPermission(services, admin.actor, { agentId: other.id, roomId: delegatedRoom,
      expectedRevision: value(services.repositories.principal.find({ id: other.id }))!.revision,
      expectedGeneration: previous.generation, permissions: ['room.agent.invite'] }, randomUUID()));
    await invite(other.token, delegatedRoom);
    const response = await accept(delegatedRoom);
    assert.equal(response.status, 200, await response.clone().text());
    const accepted = grant(delegatedRoom)!;
    assert.equal(accepted.addedById, other.id);
    assert.equal(accepted.authorizerId, other.id);
    value(await changeRoomGrant(services, other.actor, { agentId: target.id, roomId: delegatedRoom,
      expectedRevision: value(services.repositories.principal.find({ id: target.id }))!.revision,
      expectedGeneration: accepted.generation, accessMode: 'none', nativeAccess: null, muted: false }, randomUUID()));
    value(await reconcileRoomGrant(services, target.id, delegatedRoom));
    assert(!value(await services.messaging.joined(target.backendUserId)).includes(delegatedRoom));
    const unrelated = grant(roomId)!;
    assert.equal((await changeRoomGrant(services, other.actor, { agentId: target.id, roomId,
      expectedRevision: value(services.repositories.principal.find({ id: target.id }))!.revision,
      expectedGeneration: unrelated.generation, accessMode: 'none', nativeAccess: null, muted: false }, randomUUID())).ok, false);
  });

  await scope.test('withdrawn invitations do not create a grant or re-invite a target', async () => {
    const roomId = await create(owner.token);
    await invite(owner.token, roomId);
    const proof = value(await services.messaging.invitation(target.backendUserId, roomId))!;
    value(await native(owner.token, 'POST', '/rooms/' + segment(roomId) + '/kick', { user_id: target.backendUserId }));
    assert.equal(value(await services.messaging.invitation(target.backendUserId, roomId)), null);
    const response = await accept(roomId);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { data: { accepted: boolean } }).data.accepted, false);
    assert.equal(grant(roomId), null);
    const applied = await services.messaging.setRoomAccess(ownerId, target.backendUserId, roomId, { accessMode: 'reply', muted: false, nativeAccess: { powerLevel: 0 } },
      { kind: 'invitation', eventId: proof.eventId, senderBackendUserId: proof.senderBackendUserId });
    assert.equal(applied.ok, false);
    assert.equal(value(await services.messaging.membership(ownerId, target.backendUserId, roomId)).membership, 'leave');
    await invite(owner.token, roomId);
    const replacement = value(await services.messaging.invitation(target.backendUserId, roomId))!;
    assert.notEqual(replacement.eventId, proof.eventId);
    assert.equal((await services.messaging.setRoomAccess(ownerId, target.backendUserId, roomId, { accessMode: 'reply', muted: false, nativeAccess: { powerLevel: 0 } },
      { kind: 'invitation', eventId: proof.eventId, senderBackendUserId: proof.senderBackendUserId })).ok, false);
    assert.equal(value(await services.messaging.membership(ownerId, target.backendUserId, roomId)).membership, 'invite');
    assert.equal((await accept(roomId)).status, 200);
  });

  await scope.test('a fresh authorized invitation creates a new admission after removal, without restoring delegated permissions', async () => {
    const roomId = await create(owner.token);
    await invite(owner.token, roomId);
    assert.equal((await accept(roomId)).status, 200);
    const previous = grant(roomId)!;
    value(setRoomPermission(services, owner.actor, { agentId: target.id, roomId,
      expectedRevision: value(services.repositories.principal.find({ id: target.id }))!.revision,
      expectedGeneration: previous.generation, permissions: ['room.agent.invite'] }, randomUUID()));
    value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
      expectedRevision: value(services.repositories.principal.find({ id: target.id }))!.revision,
      expectedGeneration: previous.generation, accessMode: 'none', nativeAccess: null, muted: false }, randomUUID()));
    value(await reconcileRoomGrant(services, target.id, roomId));
    await invite(owner.token, roomId);
    assert.equal((await accept(roomId)).status, 200);
    assert.notEqual(grant(roomId)?.generation, previous.generation);
    assert.notEqual(grant(roomId)?.invitationEventId, previous.invitationEventId);
    assert.deepEqual(value(services.collection.roomPermissions({ agentId: target.id, roomId })), []);
  });

  await scope.test('the endpoint rejects spoofed authority, wrong receivers and human authentication', async () => {
    const roomId = await create(owner.token);
    const path = '/api/agents/' + target.id + '/room-invitation-acceptances';
    assert.equal((await http.request(path, 'POST', { roomId })).status, 401);
    assert.equal((await http.request(path, 'POST', { roomId }, http.headers(owner))).status, 401);
    assert.equal((await http.request(path, 'POST', { roomId }, { Authorization: 'Bearer ' + other.token })).status, 403);
    assert.equal((await http.request(path, 'POST', { roomId, senderBackendUserId: outsiderId }, { Authorization: 'Bearer ' + target.token })).status, 400);
    assert.equal(grant(roomId), null);
  });
});
