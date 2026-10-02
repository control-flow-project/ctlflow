import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value } from './support/application.js';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { changeMember } from '@crossfire/domain/member/change-member';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { changeInstancePolicy } from '@crossfire/domain/policy/change-policy';
import { createMemberInvitation } from '@crossfire/domain/member/invitation';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { success } from '@crossfire/kernel/result';

test('wake modes resolve active verified identities and never modify room authority', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const alice = await fixture.member('alice'), bob = await fixture.member('bob');
  const agent = await fixture.agent(alice.actor, 'self'), peer = await fixture.agent(alice.actor, 'peer'), foreign = await fixture.agent(bob.actor, 'foreign');
  const current = () => value(services.directory.agent(agent.id))!;
  const originalGrants = value(services.collection.roomGrants({ agentId: agent.id }));
  const senders = () => value(deliveryPolicy(services, agent.actor, agent.id)).wake.senders.toSorted();
  const change = (mode: 'nobody' | 'owner' | 'owner-agents' | 'humans' | 'everyone' | 'selected', senderIds: string[] = []) =>
    value(changeWakePolicy(services, alice.actor, agent.id, { expectedRevision: current().principal.revision, mode, senderIds }, randomUUID()));
  assert.deepEqual(senders(), [alice.member.principal.matrixUserId]);
  assert.equal(changeWakePolicy(services, bob.actor, agent.id, { expectedRevision: 0, mode: 'everyone', senderIds: [] }, randomUUID()).ok, false);
  change('owner-agents'); assert.deepEqual(senders(), [alice.member.principal.matrixUserId, peer.matrixUserId].sort());
  change('humans'); assert.deepEqual(senders(), [alice.member.principal.matrixUserId, peer.matrixUserId, bob.member.principal.matrixUserId, admin.member.principal.matrixUserId].sort());
  change('everyone'); assert(senders().includes(foreign.matrixUserId));
  change('selected', [bob.actor.principalId, peer.id]); assert.deepEqual(senders(), [bob.member.principal.matrixUserId, peer.matrixUserId].sort());
  value(changeMember(services, admin.actor, bob.actor.principalId, { expectedRevision: 0, status: 'suspended' }, randomUUID()));
  value(changeAgent(services, alice.actor, peer.id, { expectedRevision: 1, status: 'suspended' }, randomUUID()));
  assert.deepEqual(senders(), []); change('nobody'); assert.deepEqual(senders(), []);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: agent.id })), originalGrants);
});

test('administrator policy is revisioned, resettable and authority is checked after demotion and logout', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const deputy = await fixture.member('deputy');
  value(changeMember(services, admin.actor, deputy.actor.principalId, { expectedRevision: 0, roleCode: 'administrator' }, randomUUID()));
  const { id: _id, revision, ...initial } = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  const input = { ...initial, expectedRevision: revision, agentInstructions: 'Project policy' };
  value(changeInstancePolicy(services, deputy.actor, input, randomUUID()));
  assert.equal(changeInstancePolicy(services, admin.actor, input, randomUUID()).ok, false);
  value(changeMember(services, admin.actor, deputy.actor.principalId, { expectedRevision: 1, roleCode: 'member' }, randomUUID()));
  assert.equal(changeInstancePolicy(services, deputy.actor, { ...input, expectedRevision: 1 }, randomUUID()).ok, false);
  value(changeInstancePolicy(services, admin.actor, { ...initial, expectedRevision: 1 }, randomUUID()));
  assert.equal(value(services.repositories.instancePolicy.find({ id: 'instance' }))!.agentInstructions, initial.agentInstructions);
  value(services.repositories.memberSession.remove({ secretHash: services.identity.hash(admin.secret) }));
  assert.equal(createMemberInvitation(services, admin.actor, { roleCode: 'member', expiresSeconds: 600 }, randomUUID()).ok, false);
});

test('grant mutations recheck current authority, logout, target lifecycle and exact revisions after native calls', async scope => {
  const fixture = await applicationFixture(scope), { services, admin, native } = fixture;
  const owner = await fixture.member('owner'), agent = await fixture.agent(owner.actor, 'races');
  const roomId = value(await native.createRoom(owner.member.principal.matrixUserId, 'Race')).roomId;
  const input = { agentId: agent.id, roomId, expectedRevision: 1, expectedGeneration: null, accessMode: 'reply' as const, powerLevel: null, muted: false };
  const original = services.matrix.room; let calls = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  services.matrix.room = async (...args) => { calls++; const result = await original(...args); entered(); await new Promise<void>(resolve => { release = resolve; }); return result; };
  assert.equal((await changeRoomGrant(services, owner.actor, { ...input, expectedRevision: 2 }, randomUUID())).ok, false); assert.equal(calls, 0);
  const pending = changeRoomGrant(services, owner.actor, input, randomUUID()); await started;
  value(changeAgent(services, owner.actor, agent.id, { expectedRevision: 1, status: 'revoked' }, randomUUID())); release();
  assert.equal((await pending).ok, false); assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId })), null);
  services.matrix.room = original;
  const second = await fixture.agent(owner.actor, 'logout-race');
  services.matrix.room = async (...args) => { const result = await original(...args); value(services.repositories.memberSession.remove({ secretHash: services.identity.hash(owner.secret) })); return result; };
  assert.equal((await changeRoomGrant(services, owner.actor, { ...input, agentId: second.id }, randomUUID())).ok, false);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: second.id, roomId })), null);
  assert.equal(changeMember(services, admin.actor, admin.actor.principalId, { expectedRevision: 0, status: 'revoked' }, randomUUID()).ok, false);
});

test('name and mute edits retain the native grant revision and membership generation', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, agent = await fixture.agent(admin.actor, 'rename');
  const roomId = value(await fixture.native.createRoom(admin.member.principal.matrixUserId, 'Room')).roomId;
  const granted = value(await changeRoomGrant(services, admin.actor, { agentId: agent.id, roomId, expectedRevision: 1, expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID())).grant!;
  value(changeAgent(services, admin.actor, agent.id, { expectedRevision: 2, displayName: 'Renamed' }, randomUUID()));
  value(await changeRoomGrant(services, admin.actor, { agentId: agent.id, roomId, expectedRevision: 3, expectedGeneration: granted.generation, accessMode: 'reply', powerLevel: null, muted: true }, randomUUID()));
  const updated = value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId }))!;
  assert.equal(updated.accessRevision, granted.accessRevision); assert.equal(updated.generation, granted.generation);
  const before = value(services.repositories.principal.find({ id: agent.id }));
  const failed = services.unitOfWork.run(() => { value(services.repositories.principal.update({ ...before!, status: 'revoked' })); return { ok: false as const, error: { code: 'conflict' as const, message: 'rollback' } }; });
  assert.equal(failed.ok, false); assert.deepEqual(value(services.repositories.principal.find({ id: agent.id })), before);
  value(services.unitOfWork.run(() => success(undefined)));
});
