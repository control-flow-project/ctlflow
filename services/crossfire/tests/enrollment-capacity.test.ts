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

function introduction(ownerMatrixId: string, count: number, prefix: string) {
  return { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId, fleetKey: 'team-' + prefix,
    controller: { name: prefix + '-controller' },
    instances: Array.from({ length: count }, (_, index) => ({ instanceKey: prefix + '-' + index, name: prefix + '-' + index, coordinationPolicy: defaultCoordinationPolicy(ownerMatrixId) })) };
}

test('administrator default capacity is 100 while member owners retain the configured limit', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  const policy = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  assert.equal(policy.maxAgents, 100);
  assert.equal(policy.maxOwnerAgents, 10);
  assert.equal(value(enrollmentCapacity(services, admin.actor.principalId)).ownerLimit, 100);
  assert.equal(value(enrollmentCapacity(services, owner.actor.principalId)).ownerLimit, 10);
  value(await preflightEnrollment(services, introduction(admin.member.principal.matrixUserId, 100, 'admin')));
  value(await preflightEnrollment(services, introduction(owner.member.principal.matrixUserId, 10, 'member')));
  const refused = await preflightEnrollment(services, introduction(owner.member.principal.matrixUserId, 11, 'excess'));
  assert(!refused.ok);
  assert.equal(refused.error.code, 'capacity');
  assert.match(refused.error.message, /11 new agents; owner capacity is 0\/10 and instance capacity is 0\/100/u);
  assert.equal(value(services.collection.pendingIdentityCount()), 0);
});

test('twenty administrators agents share one approved request without policy overrides or room grants', async scope => {
  const { services, admin } = await applicationFixture(scope);
  const request = introduction(admin.member.principal.matrixUserId, 20, 'agreement');
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

test('member introduction reserves only the configured capacity and administrative reviewers cannot lend theirs', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner'), request = introduction(owner.member.principal.matrixUserId, 11, 'member');
  const receipt = value(await introduceEnrollment(services, request));
  assert.equal(receipt.instances.filter(item => item.outcome === 'claimed').length, 10);
  assert.equal(receipt.instances[10]!.failureCode, 'capacity');
  const decision = { expectedRevision: 0, decision: 'approve' as const, verificationCode: receipt.request.verificationCode };
  assert.equal(decideEnrollment(services, admin.actor, request.enrollmentId, decision, randomUUID()).ok, false);
  value(decideEnrollment(services, owner.actor, request.enrollmentId, decision, randomUUID()));
  assert.equal(value(services.directory.activeAgentCount(owner.actor.principalId)), 10);
});

test('administrator reservations still consume the instance cap and cannot race another owner', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  const request = introduction(admin.member.principal.matrixUserId, 100, 'admin');
  const receipt = value(await introduceEnrollment(services, request));
  assert.equal(receipt.instances.filter(item => item.outcome === 'claimed').length, 100);
  for (const identity of [admin.member.principal.matrixUserId, owner.member.principal.matrixUserId]) {
    const refused = await preflightEnrollment(services, introduction(identity, 1, 'blocked'));
    assert(!refused.ok);
    assert.equal(refused.error.code, 'capacity');
  }
  const other = value(await introduceEnrollment(services, introduction(owner.member.principal.matrixUserId, 1, 'other')));
  assert.equal(other.instances[0]!.failureCode, 'capacity');
  assert.equal(value(services.collection.pendingIdentityCount()), 100);
  value(decideEnrollment(services, admin.actor, request.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: receipt.request.verificationCode }, randomUUID()));
  assert.equal(value(services.directory.activeAgentCount()), 100);
});

test('approval re-resolves a demoted owner role and retains the pending request without issuing agents', async scope => {
  const { services, admin, member } = await applicationFixture(scope);
  const owner = await member('owner');
  value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 0, roleCode: 'administrator' }, randomUUID()));
  const request = introduction(owner.member.principal.matrixUserId, 20, 'promoted');
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
  const forgedInput = { ...introduction(owner.member.principal.matrixUserId, 20, 'forged'), ownerRole: 'administrator' };
  assert.equal(preflightRequest(forgedInput).ok, false);
  const forged = await preflightEnrollment(services, forgedInput);
  assert(!forged.ok);
  assert.equal(forged.error.code, 'capacity');
  assert.equal(enrollmentCapacity(services, randomUUID()).ok, false);
});
