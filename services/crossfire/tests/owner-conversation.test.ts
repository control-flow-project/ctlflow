import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cleanup } from '@crossfire/test-support/cleanup';
import { applicationFixture, value } from './support/application.js';
import { ensureOwnerConversation } from '@crossfire/domain/owner-conversation/ensure';
import { connectOwnerConversation } from '@crossfire/domain/owner-conversation/connect';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { reconcilePrincipal } from '@crossfire/domain/principal/reconcile';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { listRoomGrants } from '@crossfire/domain/room-access/read-grants';

test('enrollment creates one permanent owner DM and reconnect preserves its identity and generation', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
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

test('binding an existing private owner DM retires its discretionary invitation delegation atomically', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-owner-conversation-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'management.sqlite');
  const fixture = await applicationFixture(scope, databasePath), { services, admin } = fixture;
  const database = new Database(databasePath);
  cleanup(scope, () => database.close());
  const agent = await fixture.agent(admin.actor, 'ada');
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

test('active owner DM membership and reply permissions are repaired; suspension still wins', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
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
