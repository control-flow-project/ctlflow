import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { EnrollmentIntroduction } from '@ctlflow/crossfire-domain/enrollment/input';
import type { CoordinationPolicy } from '@ctlflow/crossfire-domain/fleet/coordination-policy';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { preflightEnrollment } from '@ctlflow/crossfire-domain/enrollment/preflight';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { readEnrollment } from '@ctlflow/crossfire-domain/enrollment/read-enrollment';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { acceptRoomInvitation } from '@ctlflow/crossfire-domain/room-access/accept-invitation';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { setRoomPermission } from '@ctlflow/crossfire-domain/room-access/set-permission';
import { changeWakePolicy } from '@ctlflow/crossfire-domain/wake/change-policy';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import { archiveFleet } from '@ctlflow/crossfire-domain/fleet/retire';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { preflight, enrollment } from '@ctlflow/crossfire-contracts/schema/request';
import { coordinationPolicy, defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { success } from '@ctlflow/crossfire-kernel/result';
import { applicationFixture, value, secret } from './support/application.js';

type Fixture = Awaited<ReturnType<typeof applicationFixture>>;
type Agent = Awaited<ReturnType<Fixture['agent']>>;
async function coordinationFixture(scope: Parameters<typeof applicationFixture>[0]): Promise<Fixture> {
  const fixture = await applicationFixture(scope);
  let controller: Agent['controller'] | undefined;
  async function agent(owner: Parameters<Fixture['agent']>[0], name: string): Promise<Agent> {
    if (owner.principalId !== fixture.admin.actor.principalId) return fixture.agent(owner, name);
    const input: EnrollmentIntroduction = { enrollmentId: randomUUID(), claimSecret: secret(),
      ownerBackendUserId: fixture.admin.member.principal.backendUserId, fleetKey: 'agreements',
      controller: { name: 'test-controller' }, ...(controller ? { controllerCredential: controller.credential } : {}),
      instances: [{ instanceKey: name, name, coordinationPolicy: defaultCoordinationPolicy(fixture.admin.member.principal.backendUserId) }] };
    const ready = await approve(fixture, input), item = ready.instances[0]!;
    assert(item.agentId && item.account);
    if (!controller) {
      assert(ready.fleet?.controllerCredential);
      controller = { fleetId: ready.fleet.fleetId, credential: ready.fleet.controllerCredential, connectionId: randomUUID() };
      fixture.renewController(controller);
    }
    return { id: item.agentId, backendUserId: item.account.userId, token: item.account.accessToken, controller,
      actor: { principalId: item.agentId, kind: 'agent' } };
  }
  return { ...fixture, agent };
}
const settings: CoordinationPolicy = { wakeMode: 'selected', senders: [{ backendUserId: '@admin:test.localhost', includeAgents: true }], permissions: ['room.agent.invite'] };
test('expired private enrollment claims reveal only terminal status, never ready credentials or controller authority', async scope => {
  const fixture = await coordinationFixture(scope), ada = await fixture.agent(fixture.admin.actor, 'ada');
  const input = request(fixture, [ada]);
  await approve(fixture, input);
  assert.equal(value(exchangeEnrollment(fixture.services, input.enrollmentId, input.claimSecret)).status, 'ready');
  fixture.advance(3_600_001);
  assert.deepEqual(value(exchangeEnrollment(fixture.services, input.enrollmentId, input.claimSecret)), {
    status: 'expired', ownerBackendUserId: fixture.admin.member.principal.backendUserId, fleet: null, instances: [],
  });
  const invalid = exchangeEnrollment(fixture.services, input.enrollmentId, secret());
  assert(!invalid.ok); assert.equal(invalid.error.code, 'unauthorized');
});
function request(fixture: Fixture, agents: Agent[], policies: CoordinationPolicy[] = agents.map(() => settings), controllerCredential?: string): EnrollmentIntroduction {
  return { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: fixture.admin.member.principal.backendUserId,
    fleetKey: 'agreements', controller: { name: 'test-controller' }, ...((controllerCredential ?? agents[0]?.controller.credential) ? { controllerCredential: controllerCredential ?? agents[0]!.controller.credential } : {}),
    instances: agents.map((agent, index) => ({ instanceKey: value(fixture.services.directory.agent(agent.id))!.name,
      name: value(fixture.services.directory.agent(agent.id))!.name, identity: { agentId: agent.id, accessToken: agent.token }, coordinationPolicy: policies[index]! })) };
}
async function approve(fixture: Fixture, input: EnrollmentIntroduction) {
  const receipt = value(await introduceEnrollment(fixture.services, input));
  if (receipt.request.status === 'pending') value(decideEnrollment(fixture.services, fixture.admin.actor, input.enrollmentId,
    { expectedRevision: receipt.request.revision, decision: 'approve', verificationCode: receipt.request.verificationCode }, randomUUID()));
  for (const item of value(fixture.services.collection.enrollmentItems({ requestId: input.enrollmentId }))) {
    if (item.agentId) value(await reconcilePrincipal(fixture.services, item.agentId));
  }
  return value(exchangeEnrollment(fixture.services, input.enrollmentId, input.claimSecret));
}
function intent(fixture: Fixture, agentId: string, roomId: string) {
  const previous = value(fixture.services.repositories.agentRoomGrant.find({ agentId, roomId }));
  return { agentId, roomId, expectedRevision: value(fixture.services.directory.agent(agentId))!.principal.revision,
    expectedGeneration: previous?.generation ?? null, accessMode: 'reply' as const, nativeAccess: null, muted: false };
}
async function assigned(fixture: Fixture, agent: Agent, roomId: string, actor = fixture.admin.actor) {
  value(await changeRoomGrant(fixture.services, actor, intent(fixture, agent.id, roomId), randomUUID()));
  value(await reconcileRoomGrant(fixture.services, agent.id, roomId));
}
function permissions(fixture: Fixture, agent: Agent, roomId: string) {
  return value(fixture.services.collection.roomPermissions({ agentId: agent.id, roomId })).map(permission => permission.permissionCode);
}

test('fleet coordination contracts are strict, complete and reject missing deployment authority', async scope => {
  const fixture = await coordinationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'ada');
  const input = request(fixture, [agent]);
  assert(preflight(input).ok === false, 'Preflight accepts no introduction-only fields');
  assert(enrollment(input).ok);
  const missing = { ...input, instances: input.instances.map(({ coordinationPolicy: _policy, ...item }) => item) };
  assert.equal(enrollment(missing).ok, false);
  assert.equal(preflight({ ownerBackendUserId: input.ownerBackendUserId, fleetKey: input.fleetKey, controller: input.controller, instances: missing.instances }).ok, false);
  assert.equal(enrollment({ ...input, fleetKey: null, controller: undefined }).ok, false);
  for (const invalid of [{ ...settings, permissions: ['policy.manage'] }, { ...settings, extra: true },
    { ...settings, senderBackendUserIds: ['@someone:test'] }, { ...settings, wakeMode: 'agents' },
    { ...settings, wakeMode: 'selected', senders: Array.from({ length: 2 }, () => ({ backendUserId: '@someone:test', includeAgents: false })) }]) assert.equal(coordinationPolicy(invalid).ok, false);
  const unknown = request(fixture, [agent], [{ ...settings, wakeMode: 'selected', senders: [{ backendUserId: '@missing:test', includeAgents: false }] }]);
  assert.equal((await preflightEnrollment(fixture.services, unknown)).ok, false);
  const self = request(fixture, [agent], [{ ...settings, wakeMode: 'selected', senders: [{ backendUserId: agent.backendUserId, includeAgents: false }] }]);
  assert.equal((await preflightEnrollment(fixture.services, self)).ok, false);
  assert.equal(value(fixture.services.collection.pendingEnrollmentCount()), 0);
});

test('owner approval configures existing grants, selected senders and future defaults without creating or joining rooms', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin, native } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada'), kit = await fixture.agent(admin.actor, 'kit'), human = await fixture.member('alice');
  const roomId = value(await native.createRoom(admin.member.principal.backendUserId, 'Matter')).roomId;
  await assigned(fixture, ada, roomId);
  const before = value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId }))!;
  value(await connectOwnerConversation(services, ada.actor, ada.id));
  const ownerDm = value(services.repositories.ownerConversation.find({ agentId: ada.id }))!.roomId;
  const selected: CoordinationPolicy = { ...settings, wakeMode: 'selected', senders: [human.member.principal.backendUserId, ada.backendUserId].map(backendUserId => ({ backendUserId, includeAgents: false })) };
  const input = request(fixture, [ada, kit], [settings, selected]);
  const receipt = value(await introduceEnrollment(services, input));
  assert.equal(receipt.request.status, 'pending');
  assert.deepEqual(receipt.instances.map(item => item.coordinationPolicy), [settings, { ...selected, senders: [...selected.senders].sort((left, right) => left.backendUserId.localeCompare(right.backendUserId)) }]);
  assert.deepEqual(value(readEnrollment(services, admin.actor, input.enrollmentId)).instances, receipt.instances);
  assert.equal(value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: input.fleetKey }))!.id, ada.controller.fleetId);
  assert.deepEqual(permissions(fixture, ada, roomId), []);
  const code = { expectedRevision: 0, decision: 'approve' as const, verificationCode: receipt.request.verificationCode };
  assert.equal(decideEnrollment(services, human.actor, input.enrollmentId, code, randomUUID()).ok, false);
  assert.equal(decideEnrollment(services, ada.actor, input.enrollmentId, code, randomUUID()).ok, false);
  const rooms = structuredClone([...native.rooms]);
  value(decideEnrollment(services, admin.actor, input.enrollmentId, code, randomUUID()));
  assert.deepEqual([...native.rooms], rooms, 'Policy approval performs no native membership operation');
  assert.deepEqual(permissions(fixture, ada, roomId), ['room.agent.invite']);
  assert.deepEqual(permissions(fixture, ada, ownerDm), []);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: kit.id })), []);
  const after = value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId }))!;
  assert.equal(after.generation, before.generation); assert.equal(after.accessRevision, before.accessRevision);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(value(deliveryPolicy(services, ada.actor, ada.id)).wake.mode, 'selected');
  assert.deepEqual(value(deliveryPolicy(services, kit.actor, kit.id)).wake.senders, selected.senders.map(sender => sender.backendUserId).sort());
  const approved = value(services.repositories.fleetPolicy.approved(ada.id))!;
  assert.equal(approved.approvedByMemberId, admin.actor.principalId);
  assert.equal(services.repositories.fleetPolicy.approve({ ...approved, approvedByMemberId: human.actor.principalId }).ok, false, 'Storage rejects a different approving owner');
});

test('fresh Element admission inherits independently approved defaults; inviter can remove only its own cross-owner additions', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin, native } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada'), kit = await fixture.agent(admin.actor, 'kit'), owner = await fixture.member('other');
  const guest = await fixture.agent(owner.actor, 'visitor');
  await approve(fixture, request(fixture, [ada, kit]));
  const roomId = value(await native.createRoom(admin.member.principal.backendUserId, 'Samosas')).roomId;
  native.rooms.get(roomId)!.members.set(ada.backendUserId, { backendUserId: ada.backendUserId, displayName: 'Ada', membership: 'invite', creator: false, powerLevel: 0 });
  native.invitations.set(roomId + ':' + ada.backendUserId, { roomId, senderBackendUserId: admin.member.principal.backendUserId, eventId: '$ada-invite', direct: false });
  assert.equal(value(await acceptRoomInvitation(services, ada.actor, ada.id, roomId, randomUUID())).accepted, true);
  assert.deepEqual(permissions(fixture, ada, roomId), ['room.agent.invite']);
  await assigned(fixture, kit, roomId, ada.actor);
  await assigned(fixture, guest, roomId, ada.actor);
  assert.deepEqual(permissions(fixture, kit, roomId), ['room.agent.invite'], 'Kit uses its own owner-approved policy');
  assert.deepEqual(permissions(fixture, guest, roomId), [], 'The inviter does not delegate its policy to a foreign agent');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: kit.id, roomId }))!.addedById, ada.id);
  assert.equal((await changeRoomGrant(services, kit.actor, { ...intent(fixture, ada.id, roomId), accessMode: 'none' }, randomUUID())).ok, false);
  for (const agent of [kit, guest]) {
    value(await changeRoomGrant(services, ada.actor, { ...intent(fixture, agent.id, roomId), accessMode: 'none' }, randomUUID()));
    value(await reconcileRoomGrant(services, agent.id, roomId));
    assert.equal(native.rooms.get(roomId)!.members.get(agent.backendUserId)!.membership, 'leave');
    assert.deepEqual(permissions(fixture, agent, roomId), []);
  }
  await assigned(fixture, kit, roomId);
  assert.equal((await changeRoomGrant(services, ada.actor, { ...intent(fixture, kit.id, roomId), accessMode: 'none' }, randomUUID())).ok, false, 'A new owner addition has different provenance');
  const room = services.messaging.authorizeRoomAccess;
  services.messaging.authorizeRoomAccess = async (...args) => {
    const facts = await room(...args);
    return facts.ok && args[0] === ada.backendUserId ? success({ ...facts.value, canInvite: false }) : facts;
  };
  assert.equal((await changeRoomGrant(services, ada.actor, intent(fixture, guest.id, roomId), randomUUID())).ok, false, 'Configured permission cannot bypass the native invite threshold');
});

test('unchanged restarts preserve per-room edits while changed coordination requires an exact new owner review', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin, native } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada'), first = await approve(fixture, request(fixture, [ada]));
  const credential = ada.controller.credential; assert.equal(first.fleet!.fleetId, ada.controller.fleetId);
  const roomId = value(await native.createRoom(admin.member.principal.backendUserId, 'Matter')).roomId;
  await assigned(fixture, ada, roomId);
  const grant = value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId }))!;
  value(setRoomPermission(services, admin.actor, { agentId: ada.id, roomId,
    expectedRevision: value(services.directory.agent(ada.id))!.principal.revision, expectedGeneration: grant.generation, permissions: [] }, randomUUID()));
  const unchanged = value(await introduceEnrollment(services, request(fixture, [ada], [settings], credential)));
  assert.equal(unchanged.request.status, 'approved'); assert.deepEqual(permissions(fixture, ada, roomId), []);
  const changed: CoordinationPolicy = { ...settings, wakeMode: 'everyone', senders: [], permissions: [] };
  const input = request(fixture, [ada], [changed], credential), pending = value(await introduceEnrollment(services, input));
  assert.equal(pending.request.status, 'pending');
  assert.equal(value(services.repositories.agent.find({ principalId: ada.id }))!.wakeMode, 'selected');
  assert.equal((await introduceEnrollment(services, { ...input, instances: [{ ...input.instances[0]!, coordinationPolicy: settings }] })).ok, false, 'The persisted request binds exact settings');
  value(decideEnrollment(services, admin.actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: pending.request.verificationCode }, randomUUID()));
  assert.equal(value(services.repositories.agent.find({ principalId: ada.id }))!.wakeMode, 'everyone');
  assert.deepEqual(value(services.repositories.fleetPolicy.approved(ada.id))!.permissions, []);
  const nextRoom = value(await native.createRoom(admin.member.principal.backendUserId, 'Next matter')).roomId;
  await assigned(fixture, ada, nextRoom); assert.deepEqual(permissions(fixture, ada, nextRoom), []);
  await approve(fixture, request(fixture, [ada], [settings], credential));
  assert.deepEqual(permissions(fixture, ada, roomId), ['room.agent.invite']);
  assert.deepEqual(permissions(fixture, ada, nextRoom), ['room.agent.invite']);
  assert.equal(value(services.directory.activeAgentCount()), 1, 'Policy reviews never duplicate an identity');
});

test('stale, rejected and deactivated-sender reviews roll back complete rosters without granting authority', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada'), kit = await fixture.agent(admin.actor, 'kit');
  const input = request(fixture, [ada, kit]), pending = value(await introduceEnrollment(services, input));
  value(changeAgent(services, admin.actor, kit.id, { expectedRevision: value(services.directory.agent(kit.id))!.principal.revision, status: 'active' }, randomUUID()));
  const decision = { expectedRevision: 0, decision: 'approve' as const, verificationCode: pending.request.verificationCode };
  assert.equal(decideEnrollment(services, admin.actor, input.enrollmentId, decision, randomUUID()).ok, false);
  assert.deepEqual(value(services.repositories.fleetPolicy.approved(ada.id))!.permissions, []);
  assert.equal(value(services.repositories.agent.find({ principalId: ada.id }))!.wakeMode, 'selected');
  assert.equal(value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: 'agreements' }))!.id, ada.controller.fleetId);
  value(decideEnrollment(services, admin.actor, input.enrollmentId, { ...decision, decision: 'reject' }, randomUUID()));
  assert.equal(value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret)).status, 'rejected');
  const selected = request(fixture, [ada], [{ ...settings, wakeMode: 'selected', senders: [{ backendUserId: kit.backendUserId, includeAgents: false }] }]);
  const review = value(await introduceEnrollment(services, selected));
  const principal = value(services.repositories.principal.find({ id: kit.id }))!;
  value(services.repositories.principal.update({ ...principal, status: 'suspended', revision: principal.revision + 1 }));
  assert.equal(decideEnrollment(services, admin.actor, selected.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: review.request.verificationCode }, randomUUID()).ok, false);
  assert.deepEqual(value(services.repositories.fleetPolicy.approved(ada.id))!.permissions, []);
});

test('wake edits require review on next start and archival preserves history without independent deployment', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin, native } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada'), enrolled = await approve(fixture, request(fixture, [ada]));
  const roomId = value(await native.createRoom(admin.member.principal.backendUserId, 'Matter')).roomId;
  await assigned(fixture, ada, roomId);
  value(changeWakePolicy(services, admin.actor, ada.id, { expectedRevision: value(services.directory.agent(ada.id))!.principal.revision,
    mode: 'selected', senders: [] }, randomUUID()));
  const pending = value(await introduceEnrollment(services, request(fixture, [ada], [settings], ada.controller.credential)));
  assert.equal(pending.request.status, 'pending');
  const fleet = value(services.repositories.fleet.findById(enrolled.fleet!.fleetId))!;
  const previousPolicy = value(services.repositories.fleetPolicy.approved(ada.id))!;
  value(archiveFleet(services, admin.actor, fleet.id, fleet.revision, randomUUID()));
  assert.deepEqual(value(services.repositories.fleetPolicy.approved(ada.id)), previousPolicy);
  assert.deepEqual(permissions(fixture, ada, roomId), ['room.agent.invite']);
  assert.equal(value(services.repositories.agent.find({ principalId: ada.id }))!.wakeMode, 'selected');
  assert.deepEqual(value(services.collection.wakeSenders({ agentId: ada.id })), []);
  const nextRoom = value(await native.createRoom(admin.member.principal.backendUserId, 'Next matter')).roomId;
  assert.equal((await changeRoomGrant(services, admin.actor, { agentId: ada.id, roomId: nextRoom,
    expectedRevision: value(services.repositories.principal.find({ id: ada.id }))!.revision,
    expectedGeneration: null, accessMode: 'reply', nativeAccess: null, muted: false }, randomUUID())).ok, false);
  assert.deepEqual(permissions(fixture, ada, nextRoom), []);
  assert.equal(value(services.repositories.fleetInstance.findByAgent(ada.id))!.retiredAt, fixture.now());
});

test('private owner DM claims never receive fleet delegation, including before native application completes', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin } = fixture;
  const ada = await fixture.agent(admin.actor, 'ada');
  await approve(fixture, request(fixture, [ada]));
  const original = services.messaging.setRoomAccess;
  let checked = false;
  services.messaging.setRoomAccess = async (...args) => {
    const conversation = value(services.repositories.ownerConversation.find({ agentId: ada.id }));
    assert.equal(conversation?.roomId, args[2], 'Privacy is bound before asynchronous native application');
    assert.deepEqual(permissions(fixture, ada, args[2]), []);
    checked = true;
    return original(...args);
  };
  value(await connectOwnerConversation(services, ada.actor, ada.id));
  assert(checked);
  const dm = value(services.repositories.ownerConversation.find({ agentId: ada.id }))!;
  assert.deepEqual(permissions(fixture, ada, dm.roomId), []);
  const guest = await fixture.agent(admin.actor, 'kit');
  assert.equal((await changeRoomGrant(services, ada.actor, intent(fixture, guest.id, dm.roomId), randomUUID())).ok, false);
  const current = value(services.repositories.agentRoomGrant.find({ agentId: ada.id, roomId: dm.roomId }))!;
  assert.equal(setRoomPermission(services, admin.actor, { agentId: ada.id, roomId: dm.roomId,
    expectedRevision: value(services.directory.agent(ada.id))!.principal.revision,
    expectedGeneration: current.generation, permissions: ['room.agent.invite'] }, randomUUID()).ok, false);
});

test('new fleet identities receive approved coordination but no room grants or preemptive owner conversations', async scope => {
  const fixture = await coordinationFixture(scope), { services, admin, native } = fixture;
  const input: EnrollmentIntroduction = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: admin.member.principal.backendUserId,
    fleetKey: 'agreements', controller: { name: 'test-controller' }, instances: ['ada', 'kit'].map(name => ({ instanceKey: name, name, coordinationPolicy: settings })) };
  const ready = await approve(fixture, input);
  assert.equal(ready.status, 'ready'); assert.equal(native.rooms.size, 0);
  for (const item of ready.instances) {
    assert.equal(value(services.repositories.agent.find({ principalId: item.agentId! }))!.wakeMode, 'selected');
    assert.deepEqual(value(services.collection.wakeSenders({ agentId: item.agentId! })), [{ agentId: item.agentId, senderPrincipalId: admin.actor.principalId, includeAgents: true }]);
    assert.deepEqual(value(services.repositories.fleetPolicy.approved(item.agentId!))!.permissions, ['room.agent.invite']);
    assert.deepEqual(value(services.collection.roomGrants({ agentId: item.agentId! })), []);
    assert.equal(value(services.repositories.ownerConversation.find({ agentId: item.agentId! })), null);
  }
  assert.deepEqual(defaultCoordinationPolicy('@admin:test.localhost'), { wakeMode: 'selected', senders: [{ backendUserId: '@admin:test.localhost', includeAgents: false }], permissions: [] });
});
