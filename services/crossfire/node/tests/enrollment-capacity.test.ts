import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { enrollmentCapacity } from '@ctlflow/crossfire-domain/enrollment/capacity';
import { preflightEnrollment } from '@ctlflow/crossfire-domain/enrollment/preflight';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { changeInstancePolicy } from '@ctlflow/crossfire-domain/policy/change-policy';
import { preflight as preflightRequest } from '@ctlflow/crossfire-contracts/schema/request';
import { applicationFixture, secret, value } from './support/application.js';

function introduction(ownerBackendUserId: string, count: number, prefix: string) {
  return { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId, fleetKey: 'team-' + prefix,
    controller: { name: prefix + '-controller' },
    instances: Array.from({ length: count }, (_, index) => ({ instanceKey: prefix + '-' + index, name: prefix + '-' + index, coordinationPolicy: defaultCoordinationPolicy(ownerBackendUserId) })) };
}

test('concurrent introductions reject all colliding names and leave no partial roster', async scope => {
  const { services, admin } = await applicationFixture(scope);
  const first = introduction(admin.member.principal.backendUserId, 2, 'shared');
  const second = { ...introduction(admin.member.principal.backendUserId, 3, 'later'),
    instances: [...first.instances, introduction(admin.member.principal.backendUserId, 1, 'unique').instances[0]!] };
  const outcomes = await Promise.all([introduceEnrollment(services, first), introduceEnrollment(services, second)]);
  assert(outcomes[0]!.ok); assert(!outcomes[1]!.ok);
  assert.equal(outcomes[1]!.error.code, 'name_collision');
  assert.match(outcomes[1]!.error.message, /shared-0, shared-1/u);
  assert.equal(value(services.repositories.enrollmentRequest.find({ id: second.enrollmentId })), null);
  assert.deepEqual(value(services.collection.enrollmentItems({ requestId: second.enrollmentId })), []);
  assert.equal(value(services.repositories.agentName.find({ name: 'unique-0' })), null);
  assert.equal(value(services.collection.pendingIdentityCount()), 2);
});

test('administrator default capacity is 100 while member owners retain the configured limit', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  const policy = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  assert.equal(policy.maxAgents, 100);
  assert.equal(policy.maxOwnerAgents, 10);
  assert.equal(value(enrollmentCapacity(services, admin.actor.principalId)).ownerLimit, 100);
  assert.equal(value(enrollmentCapacity(services, owner.actor.principalId)).ownerLimit, 10);
  value(await preflightEnrollment(services, introduction(admin.member.principal.backendUserId, 100, 'admin')));
  value(await preflightEnrollment(services, introduction(owner.member.principal.backendUserId, 10, 'member')));
  const refused = await preflightEnrollment(services, introduction(owner.member.principal.backendUserId, 11, 'excess'));
  assert(!refused.ok);
  assert.equal(refused.error.code, 'capacity');
  assert.match(refused.error.message, /11 new agents; owner capacity is 0\/10 and instance capacity is 0\/100/u);
  assert.equal(value(services.collection.pendingIdentityCount()), 0);
});

test('twenty administrators agents share one approved request without policy overrides or room grants', async scope => {
  const { services, admin } = await applicationFixture(scope);
  const request = introduction(admin.member.principal.backendUserId, 20, 'agreement');
  value(await preflightEnrollment(services, request));
  const receipt = value(await introduceEnrollment(services, request));
  assert.equal(receipt.instances.filter(item => item.outcome === 'claimed').length, 20);
  assert.equal(value(enrollmentCapacity(services, admin.actor.principalId)).remaining, 80);
  value(decideEnrollment(services, admin.actor, request.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: receipt.request.verificationCode }, randomUUID()));
  const items = value(services.collection.enrollmentItems({ requestId: request.enrollmentId }));
  assert(items.every(item => item.agentId !== null));
  assert.equal(value(services.directory.activeAgentCount(admin.actor.principalId)), 20);
  assert.equal(value(services.collection.pendingIdentityCount(admin.actor.principalId)), 0);
  for (const item of items) {
    const agent = value(services.directory.agent(item.agentId!))!;
    assert.equal(agent.agent.wakeMode, 'selected');
    assert.deepEqual(value(services.collection.wakeSenders({ agentId: item.agentId! })), [{ agentId: item.agentId!, senderPrincipalId: admin.actor.principalId, includeAgents: false }]);
    assert.deepEqual(value(services.collection.roomGrants({ agentId: item.agentId! })), []);
  }
  assert.equal(value(services.repositories.instancePolicy.find({ id: 'instance' }))!.maxOwnerAgents, 10);
});

test('member introduction rejects an oversized entire roster without reserving names or capacity', async scope => {
  const { services, member } = await applicationFixture(scope);
  const owner = await member('owner'), request = introduction(owner.member.principal.backendUserId, 11, 'member');
  const refused = await introduceEnrollment(services, request);
  assert(!refused.ok); assert.equal(refused.error.code, 'capacity');
  assert.equal(value(services.repositories.enrollmentRequest.find({ id: request.enrollmentId })), null);
  assert.equal(value(services.collection.pendingIdentityCount()), 0);
  for (const instance of request.instances) assert.equal(value(services.repositories.agentName.find({ name: instance.name })), null);
  assert.equal(value(services.directory.activeAgentCount(owner.actor.principalId)), 0);
});

test('administrator reservations still consume the instance cap and cannot race another owner', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  const request = introduction(admin.member.principal.backendUserId, 100, 'admin');
  const receipt = value(await introduceEnrollment(services, request));
  assert.equal(receipt.instances.filter(item => item.outcome === 'claimed').length, 100);
  for (const identity of [admin.member.principal.backendUserId, owner.member.principal.backendUserId]) {
    const refused = await preflightEnrollment(services, introduction(identity, 1, 'blocked'));
    assert(!refused.ok);
    assert.equal(refused.error.code, 'capacity');
  }
  const other = await introduceEnrollment(services, introduction(owner.member.principal.backendUserId, 1, 'other'));
  assert(!other.ok); assert.equal(other.error.code, 'capacity');
  assert.equal(value(services.collection.pendingIdentityCount()), 100);
  value(decideEnrollment(services, admin.actor, request.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: receipt.request.verificationCode }, randomUUID()));
  assert.equal(value(services.directory.activeAgentCount()), 100);
});

test('approval re-resolves a demoted owner role and retains the pending request without issuing agents', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 0, roleCode: 'administrator' }, randomUUID()));
  const request = introduction(owner.member.principal.backendUserId, 20, 'promoted');
  value(await preflightEnrollment(services, request));
  const receipt = value(await introduceEnrollment(services, request));
  value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 1, roleCode: 'member' }, randomUUID()));
  const refused = decideEnrollment(services, owner.actor, request.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: receipt.request.verificationCode }, randomUUID());
  assert(!refused.ok);
  assert.equal(refused.error.code, 'limit');
  assert.equal(value(services.directory.activeAgentCount(owner.actor.principalId)), 0);
  assert.equal(value(services.repositories.enrollmentRequest.find({ id: request.enrollmentId }))!.status, 'pending');
  assert(value(services.collection.enrollmentItems({ requestId: request.enrollmentId })).every(item => item.agentId === null));
});

test('administrator capacity tracks configured instance capacity rather than a caller-supplied role', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  const { id: _id, revision, ...settings } = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  value(changeInstancePolicy(services, admin.actor, { ...settings, expectedRevision: revision, maxAgents: 40, maxOwnerAgents: 3 }, randomUUID()));
  assert.equal(value(enrollmentCapacity(services, admin.actor.principalId)).ownerLimit, 40);
  assert.equal(value(enrollmentCapacity(services, owner.actor.principalId)).ownerLimit, 3);
  const forgedInput = { ...introduction(owner.member.principal.backendUserId, 20, 'forged'), ownerRole: 'administrator' };
  assert.equal(preflightRequest(forgedInput).ok, false);
  const forged = await preflightEnrollment(services, forgedInput);
  assert(!forged.ok);
  assert.equal(forged.error.code, 'capacity');
  assert.equal(enrollmentCapacity(services, randomUUID()).ok, false);
});
