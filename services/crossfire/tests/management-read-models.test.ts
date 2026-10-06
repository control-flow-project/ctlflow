import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { listEnrollments, readEnrollment } from '@ctlflow/crossfire-domain/enrollment/read-enrollment';
import { readAuditEvents } from '@ctlflow/crossfire-domain/audit/read-events';
import { recordEvent } from '@ctlflow/crossfire-domain/audit/record-event';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { auditActionLabel } from '../apps/web/src/audit-labels.js';
import { applicationFixture, secret, value } from './support/application.js';
import { httpFixture } from './support/http.js';

test('management read models hydrate recognizable identities in one batch after scoped authorization', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const alice = await fixture.member('alice'), bob = await fixture.member('bob'), agent = await fixture.agent(alice.actor, 'bea');
  for (const owner of [alice, bob]) value(await introduceEnrollment(services, {
    enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: owner.member.principal.matrixUserId,
    fleetKey: 'pending-fleet', controller: { name: 'Pending computer' }, instances: [{ instanceKey: 'pending-' + owner.member.member.displayName, name: 'pending-' + owner.member.member.displayName, coordinationPolicy: defaultCoordinationPolicy(owner.member.principal.matrixUserId) }],
  }));
  const calls: string[][] = [];
  const projected = { ...services, discovery: { ...services.discovery, selected(ids: string[]) { calls.push(ids); return services.discovery.selected(ids); } } };
  const enrollments = value(listEnrollments(projected, admin.actor, { page: 1, pageSize: 100 }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.length, 2, 'One unique owner batch, not a query per request');
  for (const item of enrollments.items) {
    assert.equal(item.owner.principalId, item.request.ownerId);
    assert(['alice', 'bob'].includes(item.owner.displayName));
  }
  calls.length = 0;
  const owned = value(listEnrollments(projected, alice.actor, { page: 1, pageSize: 100 }));
  assert(owned.items.every(item => item.owner.principalId === alice.actor.principalId));
  assert.deepEqual(calls, [[alice.actor.principalId]]);
  const privateRequest = enrollments.items.find(item => item.request.ownerId === bob.actor.principalId)!;
  calls.length = 0;
  assert.equal(readEnrollment(projected, alice.actor, privateRequest.request.id).ok, false);
  assert.equal(listEnrollments(projected, alice.actor, { page: 1, pageSize: 100, ownerId: bob.actor.principalId }).ok, false);
  assert.equal(calls.length, 0, 'Unauthorized records never hydrate another owner');
  fixture.advance(1000);
  for (let index = 0; index < 100; index++) value(recordEvent(services, index % 2 ? alice.actor : agent.actor, randomUUID(), {
    targetKind: 'agent', targetId: agent.id, ownerId: alice.actor.principalId, action: 'agent.configure',
  }));
  calls.length = 0;
  const events = value(readAuditEvents(projected, alice.actor, { page: 1, pageSize: 100 }));
  assert.equal(events.items.length, 100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.length, 2, 'Actors and targets share one unique batched directory read');
  assert(events.items.every(item => item.actor?.displayName === 'alice' || item.actor?.displayName === 'bea (alice)'));
  assert(events.items.every(item => item.target?.principalId === agent.id && item.target.displayName === 'bea (alice)'));
  assert(value(readAuditEvents(projected, bob.actor, { page: 1, pageSize: 100 })).items.every(item => item.ownerId === bob.actor.principalId));
  const principal = value(services.repositories.principal.find({ id: agent.id }))!;
  value(services.repositories.principal.update({ ...principal, status: 'revoked', revision: principal.revision + 1 }));
  assert(value(readAuditEvents(projected, alice.actor, { page: 1, pageSize: 100 })).items.every(item => item.target?.displayName === 'bea (alice)'), 'Inactive historical actors retain identifiable labels without restoring authority');
  const unavailable = { ...services, discovery: { ...services.discovery, selected: () => failure('unavailable', 'Directory unavailable') } };
  assert.equal(listEnrollments(unavailable, alice.actor, { page: 1, pageSize: 10 }).ok, false);
  assert.equal(readAuditEvents(unavailable, alice.actor, { page: 1, pageSize: 10 }).ok, false);
});

test('canonical enrollment and activity HTTP contracts expose identities without private state', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const alice = await fixture.member('alice');
  const { origin } = await httpFixture(scope, fixture.application);
  const client = (session: { secret: string }) => createClient({ origin, fetch: (input, options) => fetch(input, {
    ...options, headers: { ...options?.headers, Cookie: '__Host-crossfire=' + session.secret },
  }) });
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: alice.member.principal.matrixUserId,
    fleetKey: 'pending-fleet', controller: { name: 'Pending computer' }, instances: [{ instanceKey: 'pending', name: 'pending', coordinationPolicy: defaultCoordinationPolicy(alice.member.principal.matrixUserId) }] };
  const introduced = value(await client(alice).call(operations.introduceEnrollment, {}, input)).data;
  assert.equal(introduced.enrollment.enrollment.owner.displayName, 'alice');
  assert.equal(introduced.enrollment.enrollment.owner.matrixUserId, alice.member.principal.matrixUserId);
  assert.deepEqual(value(await client(alice).call(operations.enrollment, { enrollmentId: input.enrollmentId }, {})).data, introduced.enrollment);
  const listed = value(await client(admin).call(operations.enrollments, {}, {})).data;
  assert.equal(listed[0]?.owner.displayName, 'alice');
  value(recordEvent(services, admin.actor, randomUUID(), { targetKind: 'member', targetId: alice.actor.principalId,
    ownerId: alice.actor.principalId, action: 'member.configure' }));
  const audit = value(await client(admin).call(operations.audit, {}, {})).data;
  assert.equal(audit[0]?.actor?.displayName, admin.member.member.displayName);
  assert.equal(audit[0]?.target?.displayName, 'alice');
  const serialized = JSON.stringify({ introduced, listed, audit });
  for (const privateValue of [input.claimSecret, services.identity.hash(input.claimSecret), admin.secret, alice.secret, alice.token]) assert(!serialized.includes(privateValue));
});

test('activity action labels are readable while unknown recorded actions retain their identity', () => {
  assert.equal(auditActionLabel('instance-policy.configure'), 'Change instance settings');
  assert.equal(auditActionLabel('room-permission.set'), 'Change invitation permission');
  assert.equal(auditActionLabel('fleet.delivery.deactivate'), 'Pause fleet delivery');
  assert.equal(auditActionLabel('fleet.delivery.activate'), 'Resume fleet delivery');
  assert.equal(auditActionLabel('wake-rule.create'), 'Create Wake-up');
  assert.equal(auditActionLabel('wake-rule.update'), 'Update Wake-up');
  assert.equal(auditActionLabel('wake-rule.delete'), 'Delete Wake-up');
  assert.equal(auditActionLabel('publication.create'), 'Prepare report');
  assert.equal(auditActionLabel('publication.publish'), 'Publish report');
  assert.equal(auditActionLabel('publication.delete'), 'Delete report');
  assert.equal(auditActionLabel('recorded.native.action'), 'recorded.native.action');
  for (const action of ['constructor', 'toString', '__proto__']) assert.equal(auditActionLabel(action), action);
});
