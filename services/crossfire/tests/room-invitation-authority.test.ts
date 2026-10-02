import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToOperations } from 'node:timers/promises';
import { success, failure } from '@crossfire/kernel/result';
import { acceptRoomInvitation } from '@crossfire/domain/room-access/accept-invitation';
import { changeMember } from '@crossfire/domain/member/change-member';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { applicationFixture, value } from './support/application.js';

async function invitedFixture(scope: TestContext) {
  const fixture = await applicationFixture(scope), owner = await fixture.member('alice');
  const target = await fixture.agent(owner.actor, 'ada'), roomId = value(await fixture.native.createRoom(owner.member.principal.matrixUserId, 'Matter')).roomId;
  fixture.native.rooms.get(roomId)!.members.set(target.matrixUserId, { matrixUserId: target.matrixUserId, displayName: 'Ada', membership: 'invite', creator: false, powerLevel: 0 });
  fixture.native.invitations.set(roomId + ':' + target.matrixUserId, { roomId, eventId: '$original-invite', senderMatrixId: owner.member.principal.matrixUserId, direct: false });
  return { ...fixture, owner, target, roomId };
}

test('invitation admission and background reconciliation share exclusive room application ownership', async scope => {
  const fixture = await invitedFixture(scope), { services, target, roomId } = fixture;
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const releasing = new Promise<void>(resolve => { release = resolve; });
  const original = services.matrix.setRoomAccess;
  let active = 0, maximum = 0, calls = 0;
  services.matrix.setRoomAccess = async (...input) => {
    active++; maximum = Math.max(maximum, active);
    try {
      if (++calls === 1) { entered(); await releasing; }
      return await original(...input);
    } finally { active--; }
  };
  const admission = acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  await entering;
  const upkeep = reconcileRoomGrant(services, target.id, roomId);
  await yieldToOperations();
  release();
  assert.equal(value(await admission).accepted, true);
  value(await upkeep);
  assert.equal(maximum, 1, 'A second reconciler cannot enter native application with a stale membership snapshot');
  assert.equal(calls, 2);
  assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))?.errorCode, null);
  assert.equal(fixture.native.rooms.get(roomId)?.members.get(target.matrixUserId)?.membership, 'join');
});

test('native invitation admission rechecks owner and target authority after native reads', async scope => {
  for (const changed of ['owner', 'target'] as const) await scope.test(changed, async control => {
    const fixture = await invitedFixture(control), { services, owner, target, roomId, admin } = fixture;
    const original = services.matrix.room;
    services.matrix.room = async (...input) => {
      const facts = await original(...input);
      if (changed === 'owner') value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 0, status: 'suspended' }, randomUUID()));
      else value(changeAgent(services, owner.actor, target.id, { expectedRevision: 0, status: 'revoked' }, randomUUID()));
      return facts;
    };
    const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
    assert.equal(accepted.ok, false);
    assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId })), null);
    assert.equal(fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)?.membership, 'invite');
  });
});

test('native admission never claims read-and-reply access above the current authorizer ceiling', async scope => {
  const fixture = await invitedFixture(scope), { services, target, roomId } = fixture;
  const original = services.matrix.room;
  services.matrix.room = async (...input) => {
    const facts = await original(...input);
    return facts.ok ? success({ ...facts.value, creator: false, powerLevel: -1 }) : facts;
  };
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'forbidden');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId })), null);
});

test('losing reply authority after grant approval cannot admit a read-only room as read-and-reply', async scope => {
  const fixture = await invitedFixture(scope), { services, target, roomId } = fixture;
  const original = services.matrix.room;
  let calls = 0;
  services.matrix.room = async (...input) => {
    const facts = await original(...input);
    return facts.ok && ++calls > 1 ? success({ ...facts.value, creator: false, powerLevel: -1 }) : facts;
  };
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'forbidden');
  const application = value(services.repositories.roomGrantApplication.find({ agentId: target.id, roomId }))!;
  assert.equal(application.membership, 'leave');
  assert.equal(application.errorCode, 'forbidden');
  assert.equal(fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)?.membership, 'leave');
});

test('withdrawing delegation during a native invitation check prevents a cross-owner addition', async scope => {
  const fixture = await invitedFixture(scope), { services, admin, target, roomId } = fixture;
  const other = await fixture.member('bob'), inviter = await fixture.agent(other.actor, 'jo');
  fixture.native.rooms.get(roomId)!.members.set(admin.member.principal.matrixUserId, {
    matrixUserId: admin.member.principal.matrixUserId, displayName: 'Admin', membership: 'join', creator: false, powerLevel: 100 });
  const assigned = value(await changeRoomGrant(services, admin.actor, { agentId: inviter.id, roomId, expectedRevision: 0,
    expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID())).grant!;
  value(await reconcileRoomGrant(services, inviter.id, roomId));
  value(setRoomPermission(services, other.actor, { agentId: inviter.id, roomId, expectedRevision: 1,
    expectedGeneration: assigned.generation, permissions: ['room.agent.invite'] }, randomUUID()));
  fixture.native.invitations.set(roomId + ':' + target.matrixUserId, { roomId, eventId: '$delegated-invite', senderMatrixId: inviter.matrixUserId, direct: false });
  const original = services.matrix.room;
  services.matrix.room = async (...input) => {
    const facts = await original(...input);
    value(setRoomPermission(services, other.actor, { agentId: inviter.id, roomId, expectedRevision: 2,
      expectedGeneration: assigned.generation, permissions: [] }, randomUUID()));
    return facts;
  };
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'conflict');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId })), null);
});

test('the same unconsumed native invitation cannot undo an owner removal', async scope => {
  const fixture = await invitedFixture(scope), { services, owner, target, roomId } = fixture;
  value(await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID()));
  const previous = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, accessMode: 'none', powerLevel: null, muted: false }, randomUUID()));
  fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)!.membership = 'invite';
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'forbidden');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))?.accessMode, 'none');
  value(await reconcileRoomGrant(services, target.id, roomId));
  assert.equal(fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)?.membership, 'leave');
});

test('owner access edits retain invitation addition provenance and existing delegation', async scope => {
  const fixture = await invitedFixture(scope), { services, owner, target, roomId } = fixture;
  value(await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID()));
  const previous = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  value(setRoomPermission(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, permissions: ['room.agent.invite'] }, randomUUID()));
  value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, accessMode: 'custom', powerLevel: 25, muted: false }, randomUUID()));
  value(await reconcileRoomGrant(services, target.id, roomId));
  const current = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  assert.equal(current.generation, previous.generation);
  assert.equal(current.addedById, previous.addedById);
  assert.equal(current.invitationEventId, previous.invitationEventId);
  assert.equal(current.admissionKind, 'managed');
  assert.equal(value(services.collection.roomPermissions({ agentId: target.id, roomId })).length, 1);
  assert.equal(fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)?.powerLevel, 25);
});

test('a delegated agent cannot take over another principal’s durable addition by issuing a new native invite', async scope => {
  const fixture = await invitedFixture(scope), { services, owner, target, roomId } = fixture;
  value(await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID()));
  const previous = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  const other = await fixture.member('bob'), inviter = await fixture.agent(other.actor, 'jo');
  const assigned = value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: 1, expectedGeneration: previous.generation, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID()));
  assert.equal(assigned.grant?.addedById, owner.actor.principalId);
  const adminId = fixture.admin.member.principal.matrixUserId;
  fixture.native.rooms.get(roomId)!.members.set(adminId, { matrixUserId: adminId, displayName: 'Admin', membership: 'join', creator: false, powerLevel: 100 });
  const delegated = value(await changeRoomGrant(services, fixture.admin.actor, { agentId: inviter.id, roomId, expectedRevision: 0,
    expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID())).grant!;
  value(await reconcileRoomGrant(services, inviter.id, roomId));
  value(setRoomPermission(services, other.actor, { agentId: inviter.id, roomId, expectedRevision: 1,
    expectedGeneration: delegated.generation, permissions: ['room.agent.invite'] }, randomUUID()));
  fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)!.membership = 'invite';
  fixture.native.invitations.set(roomId + ':' + target.matrixUserId, { roomId, eventId: '$replacement-from-jo', senderMatrixId: inviter.matrixUserId, direct: false });
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'forbidden');
  assert.deepEqual(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId })), previous);
});

test('a manual access edit cannot erase the native receipt and let an old pending invite undo removal', async scope => {
  const fixture = await invitedFixture(scope), { services, owner, target, roomId } = fixture;
  const original = services.matrix.setRoomAccess;
  services.matrix.setRoomAccess = async () => failure('native', 'Native acceptance is temporarily unavailable');
  assert.equal((await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID())).ok, false);
  services.matrix.setRoomAccess = original;
  const previous = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, accessMode: 'custom', powerLevel: 25, muted: false }, randomUUID()));
  value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, accessMode: 'none', powerLevel: null, muted: false }, randomUUID()));
  fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)!.membership = 'invite';
  const accepted = await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID());
  assert(!accepted.ok);
  assert.equal(accepted.error.code, 'forbidden');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))?.invitationEventId, previous.invitationEventId);
});

test('replaying an admitted native invite preserves later owner access and mute settings', async scope => {
  const fixture = await invitedFixture(scope), { services, owner, target, roomId } = fixture;
  const original = services.matrix.setRoomAccess;
  services.matrix.setRoomAccess = async () => failure('native', 'Native acceptance is temporarily unavailable');
  assert.equal((await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID())).ok, false);
  services.matrix.setRoomAccess = original;
  const previous = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }))!;
  value(await changeRoomGrant(services, owner.actor, { agentId: target.id, roomId,
    expectedRevision: value(services.directory.agent(target.id))!.principal.revision,
    expectedGeneration: previous.generation, accessMode: 'custom', powerLevel: 25, muted: true }, randomUUID()));
  fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)!.membership = 'invite';
  const expected = value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId }));
  assert.equal(value(await acceptRoomInvitation(services, target.actor, target.id, roomId, randomUUID())).accepted, true);
  assert.deepEqual(value(services.repositories.agentRoomGrant.find({ agentId: target.id, roomId })), expected);
  assert.equal(fixture.native.rooms.get(roomId)!.members.get(target.matrixUserId)?.powerLevel, 25);
});
