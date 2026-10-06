import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { nativeServer } from './support/native-server.js';
import { secret, value } from './support/application.js';
import { ownerSession } from './support/owner-session.js';
import { releaseFixture } from './release-fixture.js';

test('public guide and owner approval enroll a controller-bound roster without creating conversations', { timeout: 120_000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release);
  const { services, origin, native, worker, admin } = fixture;
  const publicReadme = await fetch(origin + '/onboarding/' + release.manifest.release + '/README.md');
  assert.equal(publicReadme.status, 200);
  const documentation = await publicReadme.text();
  assert(!documentation.includes(native.registrationToken));
  assert(!documentation.includes(fixture.application.config.jwtSecret));
  const publicClient = createClient({ origin });
  const roster = { ownerMatrixId: admin.member.principal.matrixUserId, fleetKey: 'holmes', controller: { name: 'Holmes controller' },
    instances: [{ instanceKey: 'holmes', name: 'holmes', coordinationPolicy: defaultCoordinationPolicy(admin.member.principal.matrixUserId) }] };
  assert.equal(value(await publicClient.call(operations.preflight, {}, roster)).data.available, true);
  const introduction = { ...roster, enrollmentId: randomUUID(), claimSecret: secret() };
  const requested = value(await publicClient.call(operations.introduceEnrollment, {}, introduction)).data;
  const request = requested.enrollment.enrollment;
  assert.equal(requested.approvalUrl, origin + '/manage/enrollments/' + introduction.enrollmentId);
  assert(!JSON.stringify(requested).includes(introduction.claimSecret));
  const exchange = () => publicClient.call(operations.exchangeEnrollment, { enrollmentId: introduction.enrollmentId }, { claimSecret: introduction.claimSecret });
  assert.equal(value(await exchange()).data.status, 'pending');
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 0);
  const decision = { expectedRevision: 0, decision: 'approve' as const, verificationCode: request.verificationCode };
  assert.equal((await fetch(origin + '/api/enrollments/' + request.enrollmentId + '/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision),
  })).status, 403);
  const owner = await ownerSession(origin, admin.token);
  assert.equal(value(await owner.call(operations.decideEnrollment, { enrollmentId: request.enrollmentId }, decision)).data.status, 'approved');
  await worker.drain();
  const connected = value(await exchange()).data;
  assert.equal(connected.status, 'ready');
  assert(connected.fleet?.controllerCredential);
  const agent = connected.instances[0]!;
  assert(agent.account && agent.agentId);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.agentId })), null);
  assert.deepEqual(value(await nativeOk({ base: native.base, token: agent.account.accessToken }, 'GET', API + '/joined_rooms')).joined_rooms, []);
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 1);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: agent.agentId })), []);
  assert.deepEqual(value(await exchange()).data, connected, 'The private claim is retryable without another identity or controller');
  const controller = createClient({ origin, token: connected.fleet.controllerCredential });
  const fleet = value(await controller.call(operations.fleet, { fleetId: connected.fleet.fleetId }, {})).data;
  assert.equal(fleet.controller.name, roster.controller.name);
  for (const invalid of [{ ...introduction, fleetKey: null }, { ...introduction, controller: null },
    { ...introduction, instances: [{ instanceKey: 'unbound', name: 'unbound' }] }]) {
    assert.equal((await fetch(origin + '/api/enrollments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid) })).status, 400, 'Removed independent enrollment forms fail at the HTTP boundary');
  }
});
