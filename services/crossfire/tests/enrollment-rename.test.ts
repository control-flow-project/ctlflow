import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { preflightEnrollment } from '@ctlflow/crossfire-domain/enrollment/preflight';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { expireEnrollments } from '@ctlflow/crossfire-domain/enrollment/expire';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { ensureOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/ensure';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { applicationFixture, secret, value } from './support/application.js';

function request(fixture: Awaited<ReturnType<typeof applicationFixture>>, agent: Awaited<ReturnType<Awaited<ReturnType<typeof applicationFixture>>['agent']>>, name = 'ada-max') {
  return { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: fixture.admin.member.principal.matrixUserId,
    fleetKey: 'test-ada', controller: { name: 'Test controller' }, controllerCredential: agent.controller.credential,
    instances: [{ instanceKey: 'ada', name, identity: { agentId: agent.id, accessToken: agent.token }, coordinationPolicy: defaultCoordinationPolicy() }] };
}

test('owner-reviewed names preserve accounts, grants, native histories and meaningful existing DM titles', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  const room = value(await ensureOwnerConversation(services, agent.id)).roomId;
  value(await reconcilePrincipal(services, agent.id));
  const before = value(services.directory.agent(agent.id))!, grants = value(services.collection.roomGrants({ agentId: agent.id }));
  const credentials = value(services.repositories.agentCredential.find({ agentId: agent.id }))!;
  const original = value(services.repositories.fleetInstance.findByAgent(agent.id))!;
  const input = request(fixture, agent), receipt = value(await introduceEnrollment(services, input));
  assert.equal(receipt.request.status, 'pending');
  assert.equal(receipt.instances[0]!.currentName, 'ada');
  assert.equal(receipt.instances[0]!.requestedName, 'ada-max');
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada');
  const decision = { expectedRevision: 0, decision: 'approve' as const, verificationCode: receipt.request.verificationCode };
  assert.equal(decideEnrollment(services, agent.actor, input.enrollmentId, decision, randomUUID()).ok, false);
  const stranger = await fixture.member('stranger');
  assert.equal(decideEnrollment(services, stranger.actor, input.enrollmentId, decision, randomUUID()).ok, false);
  value(decideEnrollment(services, admin.actor, input.enrollmentId, decision, randomUUID()));
  const current = value(services.directory.agent(agent.id))!;
  assert.equal(current.name, 'ada-max');
  assert.equal(current.principal.id, before.principal.id);
  assert.equal(current.principal.matrixUserId, before.principal.matrixUserId);
  assert.equal(current.principal.revision, before.principal.revision + 1);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: agent.id })), grants);
  assert.deepEqual(value(services.repositories.agentCredential.find({ agentId: agent.id })), credentials);
  assert.deepEqual(value(services.repositories.fleetInstance.findByAgent(agent.id)), original);
  assert.equal(value(services.repositories.agentName.find({ name: 'ada' })), null);
  assert.equal(value(services.repositories.agentName.find({ name: 'ada-max' }))!.agentId, agent.id);
  assert.equal(value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret)).status, 'provisioning');
  value(await reconcilePrincipal(services, agent.id));
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.instances[0]!.account!.matrixUserId, agent.matrixUserId);
  assert.equal(ready.instances[0]!.account!.accessToken, agent.token);
  assert.equal(fixture.native.rooms.get(room)!.name, 'ada-max (' + admin.member.member.displayName + ')');
  assert.equal(fixture.native.rooms.size, 1);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id }))!.roomId, room);
  const unchangedInput = request(fixture, agent), unchanged = value(await introduceEnrollment(services, unchangedInput));
  assert.equal(unchanged.request.status, 'approved');
  const matter = value(await fixture.native.createRoom(admin.member.principal.matrixUserId, 'Matter'));
  value(await changeRoomGrant(services, admin.actor, { agentId: agent.id, roomId: matter.roomId, expectedRevision: current.principal.revision,
    expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID()));
  assert(value(services.directory.agent(agent.id))!.principal.revision > value(services.directory.agent(agent.id))!.application.appliedRevision!);
  assert.equal(value(exchangeEnrollment(services, unchanged.request.id, unchangedInput.claimSecret)).status, 'ready');
});

test('native name application does not create chats or overwrite a human conversation title', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  const input = request(fixture, agent), introduced = value(await introduceEnrollment(services, input));
  value(decideEnrollment(services, admin.actor, input.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
  value(await reconcilePrincipal(services, agent.id));
  assert.equal(fixture.native.rooms.size, 0);
  const room = value(await ensureOwnerConversation(services, agent.id)).roomId;
  fixture.native.rooms.get(room)!.name = 'My private research';
  const next = request(fixture, agent, 'ada-high'), review = value(await introduceEnrollment(services, next));
  value(decideEnrollment(services, admin.actor, next.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: review.request.verificationCode }, randomUUID()));
  value(await reconcilePrincipal(services, agent.id));
  assert.equal(fixture.native.rooms.get(room)!.name, 'My private research');
  assert.equal(fixture.native.rooms.size, 1);
  assert.equal(exchangeEnrollment(services, input.enrollmentId, input.claimSecret).ok, false);
});

for (const decision of ['reject', 'expire'] as const) test(decision + ' releases only the proposed name and keeps the registered identity', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada'), input = request(fixture, agent);
  const receipt = value(await introduceEnrollment(services, input));
  assert.equal(value(services.repositories.agentName.find({ name: 'ada-max' }))!.agentId, null);
  if (decision === 'reject') value(decideEnrollment(services, admin.actor, input.enrollmentId,
    { expectedRevision: 0, decision, verificationCode: receipt.request.verificationCode }, randomUUID()));
  else {
    fixture.advance(1_000_000);
    value(services.unitOfWork.run(() => expireEnrollments(services)));
  }
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada');
  assert.equal(value(services.repositories.agentName.find({ name: 'ada-max' })), null);
  assert.equal(value(services.directory.activeAgentCount()), 1);
});

test('collisions and incorrect identity proof cannot reserve or overwrite another agent name', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada'), other = await fixture.agent(admin.actor, 'ada-max');
  const input = request(fixture, agent);
  assert.equal((await preflightEnrollment(services, input)).ok, false);
  assert.equal((await introduceEnrollment(services, input)).ok, false);
  input.instances[0]!.name = 'ada-high'; input.instances[0]!.identity.accessToken = other.token;
  assert.equal((await introduceEnrollment(services, input)).ok, false);
  assert.equal(value(services.repositories.agentName.find({ name: 'ada-high' })), null);
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada');
});

test('reviewed renaming needs the fleet credential but consumes no additional agent capacity', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada'), input = request(fixture, agent);
  const policy = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  value(services.unitOfWork.run(() => services.repositories.instancePolicy.update({ ...policy, maxAgents: 1, maxOwnerAgents: 1 })));
  assert.equal((await preflightEnrollment(services, { ...input, controllerCredential: '' })).ok, false);
  assert.equal((await preflightEnrollment(services, { ...input, controllerCredential: secret() })).ok, false);
  value(await preflightEnrollment(services, input));
  const review = value(await introduceEnrollment(services, input));
  value(decideEnrollment(services, admin.actor, input.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: review.request.verificationCode }, randomUUID()));
  assert.equal(value(services.directory.activeAgentCount()), 1);
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada-max');
});

test('rename failure rolls back every row and stale competing approvals cannot overwrite the accepted name', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'ada');
  const first = request(fixture, agent), second = request(fixture, agent, 'ada-high');
  const firstReceipt = value(await introduceEnrollment(services, first)), secondReceipt = value(await introduceEnrollment(services, second));
  const decide = () => decideEnrollment(services, admin.actor, first.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: firstReceipt.request.verificationCode }, randomUUID());
  const before = value(services.directory.agent(agent.id))!, update = services.repositories.agentName.update;
  services.repositories.agentName.update = () => failure('unavailable', 'Injected exact rename failure');
  assert.equal(decide().ok, false);
  services.repositories.agentName.update = update;
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada');
  assert.equal(value(services.directory.agent(agent.id))!.principal.revision, before.principal.revision);
  assert.equal(value(services.repositories.enrollmentRequest.find({ id: first.enrollmentId }))!.status, 'pending');
  value(decide());
  const stale = decideEnrollment(services, admin.actor, second.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: secondReceipt.request.verificationCode }, randomUUID());
  assert.equal(stale.ok, false);
  assert.equal(value(services.directory.agent(agent.id))!.name, 'ada-max');
  assert.equal(value(services.repositories.agentName.find({ name: 'ada-high' }))!.agentId, null);
});
