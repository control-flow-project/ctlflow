import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { applicationFixture, value } from './support/application.js';
import { ensureOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/ensure';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { setRoomPermission } from '@ctlflow/crossfire-domain/room-access/set-permission';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { listRoomGrants } from '@ctlflow/crossfire-domain/room-access/read-grants';
import { listRooms, readRoom } from '@ctlflow/crossfire-domain/room/read-room';
import { authorizeGrantChange } from '@ctlflow/crossfire-domain/room-access/authorize-change';
import { recheckGrantAuthorization } from '@ctlflow/crossfire-domain/room-access/commit-change';
import { acceptRoomInvitation } from '@ctlflow/crossfire-domain/room-access/accept-invitation';

test('enrollment and reconciliation create no chats; first use and reconnect retain one protected owner DM', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: agent.id })), []);
  assert.deepEqual(value(await services.matrix.joined(agent.matrixUserId)), []);
  value(await reconcilePrincipal(services, agent.id));
  assert.equal(fixture.native.rooms.size, 0);
  const created = await Promise.all([connectOwnerConversation(services, agent.actor, agent.id), connectOwnerConversation(services, agent.actor, agent.id)]);
  assert(created.every(result => result.ok));
  const original = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
  assert.equal(original.ownerId, admin.actor.principalId);
  const before = value(services.directory.agent(agent.id))!;
  const grant = value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: original.roomId }))!;
  assert.equal(grant.accessMode, 'reply');
  assert.equal(grant.muted, false);
  assert.equal(grant.authorizerId, admin.actor.principalId);
  assert.equal(grant.addedById, admin.actor.principalId);
  assert.equal(value(deliveryPolicy(services, agent.actor, agent.id)).ownerConversation, original.roomId);
  for (const result of await Promise.all([connectOwnerConversation(services, agent.actor, agent.id),
    ensureOwnerConversation(services, agent.id), reconcilePrincipal(services, agent.id)])) {
    if (!result.ok) assert.fail(result.error.message);
  }
  assert.deepEqual(value(services.repositories.ownerConversation.find({ agentId: agent.id })), original);
  assert.deepEqual(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: original.roomId })), grant);
  assert.equal(value(services.directory.agent(agent.id))!.principal.revision, before.principal.revision);
  assert.equal(value(services.collection.roomGrants({ agentId: agent.id })).length, 1);
  assert.deepEqual(value(listRoomGrants(services, admin.actor, agent.id, { page: 1, pageSize: 20 })).items[0]?.allowedActions, []);
});

test('owners, administrators and agents cannot downgrade, mute, remove or delegate the owner DM', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const owner = await fixture.member('alice'), agent = await fixture.agent(owner.actor, 'ada');
  const other = await fixture.agent(admin.actor, 'jo');
  value(await connectOwnerConversation(services, agent.actor, agent.id));
  const conversation = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
  const original = value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: conversation.roomId }))!;
  const revision = value(services.directory.agent(agent.id))!.principal.revision;
  for (const actor of [owner.actor, admin.actor, other.actor]) {
    for (const intent of [{ accessMode: 'none' as const, muted: false, powerLevel: null },
      { accessMode: 'read' as const, muted: false, powerLevel: null },
      { accessMode: 'custom' as const, muted: false, powerLevel: 50 },
      { accessMode: 'reply' as const, muted: true, powerLevel: null }]) {
      const changed = await changeRoomGrant(services, actor, { agentId: agent.id, roomId: conversation.roomId,
        expectedRevision: revision, expectedGeneration: original.generation, ...intent }, randomUUID());
      assert(!changed.ok); assert.equal(changed.error.code, 'forbidden');
    }
  }
  assert.equal(setRoomPermission(services, owner.actor, { agentId: agent.id, roomId: conversation.roomId,
    expectedRevision: revision, expectedGeneration: original.generation, permissions: ['room.agent.invite'] }, randomUUID()).ok, false);
  assert.equal(services.repositories.agentRoomGrant.update({ ...original, muted: true }).ok, false);
  assert.equal(services.repositories.agentRoomGrant.update({ ...original, accessMode: 'none' }).ok, false);
  assert.equal(services.repositories.agentRoomPermission.insert({ agentId: agent.id, roomId: conversation.roomId,
    generation: original.generation, permissionCode: 'room.agent.invite', grantScope: 'agent_room',
    grantedByMemberId: owner.actor.principalId, grantedAt: services.clock.now() }).ok, false);
  assert.deepEqual(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: conversation.roomId })), original);
  assert.equal((await connectOwnerConversation(services, other.actor, agent.id)).ok, false);
  assert.equal((await connectOwnerConversation(services, admin.actor, agent.id)).ok, false);
});

test('withdrawal during first owner DM verification never binds or re-invites the conversation', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  const owner = admin.member.principal.matrixUserId;
  const roomId = value(await native.createRoom(owner, 'Private matter')).roomId;
  const membership = { matrixUserId: agent.matrixUserId, displayName: 'Ada', membership: 'invite' as const, creator: false as const, powerLevel: 0 };
  native.rooms.get(roomId)!.members.set(agent.matrixUserId, membership);
  native.invitations.set(roomId + ':' + agent.matrixUserId, { roomId, senderMatrixId: owner, eventId: '$owner-dm', direct: true });
  const verify = services.matrix.verifyOwnerConversation;
  services.matrix.verifyOwnerConversation = async (...input) => {
    const result = await verify(...input);
    native.invitations.delete(roomId + ':' + agent.matrixUserId);
    native.rooms.get(roomId)!.members.set(agent.matrixUserId, { ...membership, membership: 'leave' });
    return result;
  };
  assert.equal((await acceptRoomInvitation(services, agent.actor, agent.id, roomId, randomUUID())).ok, false);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId })), null);
  assert.equal(native.rooms.size, 1, 'No alternate approval conversation is created');
  assert.equal(native.rooms.get(roomId)!.members.get(agent.matrixUserId)!.membership, 'leave');
  const reconciled = await reconcileRoomGrant(services, agent.id, roomId);
  assert(!reconciled.ok); assert.equal(reconciled.error.code, 'missing');
  assert.equal(native.rooms.get(roomId)!.members.get(agent.matrixUserId)!.membership, 'leave');
});

test('withdrawal after a private DM claim never acquires confirmed owner-conversation repair authority', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada'), owner = admin.member.principal.matrixUserId;
  const roomId = value(await native.createRoom(owner, 'Private matter')).roomId;
  const membership = { matrixUserId: agent.matrixUserId, displayName: 'Ada', membership: 'invite' as const, creator: false as const, powerLevel: 0 };
  native.rooms.get(roomId)!.members.set(agent.matrixUserId, membership);
  native.invitations.set(roomId + ':' + agent.matrixUserId, { roomId, senderMatrixId: owner, eventId: '$owner-dm', direct: true });
  const apply = services.matrix.setRoomAccess;
  services.matrix.setRoomAccess = async (...input) => {
    assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id }))!.roomId, roomId);
    native.invitations.delete(roomId + ':' + agent.matrixUserId);
    native.rooms.get(roomId)!.members.set(agent.matrixUserId, { ...membership, membership: 'leave' });
    return apply(...input);
  };
  assert.equal((await acceptRoomInvitation(services, agent.actor, agent.id, roomId, randomUUID())).ok, false);
  assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId }))!.lastSuccessAt, null);
  value(await reconcileRoomGrant(services, agent.id, roomId));
  assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId }))!.lastSuccessAt, null);
  value(await reconcilePrincipal(services, agent.id));
  assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId }))!.lastSuccessAt, null);
  assert.equal(native.rooms.get(roomId)!.members.get(agent.matrixUserId)!.membership, 'leave');
  assert.equal(native.rooms.size, 1);
});

test('binding an existing private owner DM retires its discretionary invitation delegation atomically', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-owner-conversation-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'management.sqlite');
  const fixture = await applicationFixture(scope, databasePath), { services, admin } = fixture;
  const database = new Database(databasePath);
  cleanup(scope, () => database.close());
  const agent = await fixture.agent(admin.actor, 'ada');
  value(await connectOwnerConversation(services, agent.actor, agent.id));
  const previous = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
  const grant = value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: previous.roomId }))!;
  database.prepare('DELETE FROM agent_owner_conversation WHERE agent_id = ?').run(agent.id);
  value(setRoomPermission(services, admin.actor, { agentId: agent.id, roomId: previous.roomId,
    expectedRevision: value(services.directory.agent(agent.id))!.principal.revision, expectedGeneration: grant.generation,
    permissions: ['room.agent.invite'] }, randomUUID()));
  value(await ensureOwnerConversation(services, agent.id));
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id }))!.roomId, previous.roomId);
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: agent.id, roomId: previous.roomId })), []);
});

test('owner DMs exclude other agents at authorization, storage and room-discovery boundaries', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const alice = await fixture.member('alice'), bob = await fixture.member('bob');
  const ada = await fixture.agent(alice.actor, 'ada'), jo = await fixture.agent(alice.actor, 'jo'), remy = await fixture.agent(bob.actor, 'remy');
  value(await connectOwnerConversation(services, ada.actor, ada.id));
  value(await connectOwnerConversation(services, jo.actor, jo.id));
  const conversation = value(services.repositories.ownerConversation.find({ agentId: ada.id }))!;
  const original = value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId: conversation.roomId }))!;
  assert.deepEqual(value(services.repositories.ownerConversation.findByRoom({ roomId: conversation.roomId })), conversation);
  for (const agent of [jo, remy]) {
    const revision = value(services.directory.agent(agent.id))!.principal.revision;
    for (const actor of [alice.actor, bob.actor, admin.actor, ada.actor]) {
      const changed = await changeRoomGrant(services, actor, { agentId: agent.id, roomId: conversation.roomId,
        expectedRevision: revision, expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID());
      assert(!changed.ok); assert.equal(changed.error.code, 'forbidden');
    }
    const grant = { ...original, agentId: agent.id, generation: randomUUID() };
    assert.equal(services.repositories.agentRoomGrant.insert(grant).ok, false);
    value(services.repositories.agentRoomGrant.insert({ ...grant, accessMode: 'none' }));
    assert.equal(services.repositories.agentRoomGrant.update(grant).ok, false);
    assert.equal(services.repositories.agentRoomPermission.insert({ agentId: agent.id, roomId: conversation.roomId,
      generation: grant.generation, permissionCode: 'room.agent.invite', grantScope: 'agent_room',
      grantedByMemberId: alice.actor.principalId, grantedAt: services.clock.now() }).ok, false);
    const observed = await readRoom(services, admin.actor, conversation.roomId, agent.id);
    assert(!observed.ok); assert.equal(observed.error.code, 'forbidden');
    const rooms = value(await listRooms(services, admin.actor, { agentId: agent.id, search: '', page: 1, pageSize: 100 }));
    assert.equal(rooms.items.some(room => room.roomId === conversation.roomId), false);
  }
  const rooms = value(await listRooms(services, alice.actor, { agentId: jo.id, search: '', page: 1, pageSize: 100 }));
  assert.deepEqual(rooms.items.map(room => room.roomId), [value(services.repositories.ownerConversation.find({ agentId: jo.id }))!.roomId]);
  assert.deepEqual(value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId: conversation.roomId })), original);
});

test('active owner DM membership and reply permissions are repaired; suspension still wins', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  value(await connectOwnerConversation(services, agent.actor, agent.id));
  const conversation = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
  const member = native.rooms.get(conversation.roomId)!.members.get(agent.matrixUserId)!;
  member.membership = 'leave'; member.powerLevel = -1;
  value(await reconcileRoomGrant(services, agent.id, conversation.roomId));
  assert.equal(native.rooms.get(conversation.roomId)!.members.get(agent.matrixUserId)!.membership, 'join');
  assert.equal(native.rooms.get(conversation.roomId)!.members.get(agent.matrixUserId)!.powerLevel, 0);
  const revision = value(services.directory.agent(agent.id))!.principal.revision;
  value(changeAgent(services, admin.actor, agent.id, { expectedRevision: revision, status: 'suspended' }, randomUUID()));
  value(await reconcilePrincipal(services, agent.id));
  value(await reconcileRoomGrant(services, agent.id, conversation.roomId));
  assert.equal(native.rooms.get(conversation.roomId)!.members.get(agent.matrixUserId)!.membership, 'leave');
  assert.equal((await connectOwnerConversation(services, agent.actor, agent.id)).ok, false);
  value(changeAgent(services, admin.actor, agent.id, { expectedRevision: revision + 1, status: 'active' }, randomUUID()));
  value(await reconcilePrincipal(services, agent.id));
  assert.equal(native.rooms.get(conversation.roomId)!.members.get(agent.matrixUserId)!.membership, 'join');
  assert.deepEqual(value(services.repositories.ownerConversation.find({ agentId: agent.id })), conversation);
});

test('binding an owner DM invalidates pending third-party grant authorization at commit', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-owner-binding-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'management.sqlite');
  const fixture = await applicationFixture(scope, databasePath), { services, admin } = fixture;
  const database = new Database(databasePath);
  cleanup(scope, () => database.close());
  const ada = await fixture.agent(admin.actor, 'ada'), jo = await fixture.agent(admin.actor, 'jo');
  value(await connectOwnerConversation(services, ada.actor, ada.id));
  const conversation = value(services.repositories.ownerConversation.find({ agentId: ada.id }))!;
  database.prepare('DELETE FROM agent_owner_conversation WHERE agent_id = ?').run(ada.id);
  const input = { agentId: jo.id, roomId: conversation.roomId, expectedRevision: value(services.directory.agent(jo.id))!.principal.revision,
    expectedGeneration: null, accessMode: 'reply' as const, powerLevel: null, muted: false };
  const proof = value(await authorizeGrantChange(services, admin.actor, input));
  value(services.repositories.ownerConversation.insert(conversation));
  const rechecked = services.unitOfWork.run(() => recheckGrantAuthorization(services, admin.actor, proof));
  assert(!rechecked.ok); assert.equal(rechecked.error.code, 'forbidden');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: jo.id, roomId: conversation.roomId })), null);
});
