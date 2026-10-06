import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { success } from '@ctlflow/crossfire-kernel/result';
import { withHuman } from '../tools/auth.js';
import { verifyServer } from '../tools/server.js';
import { verifyRelease } from '../tools/release.js';
import { reviewEnrollment } from '../tools/enrollment.js';
import { operatorFixture } from './support/operator.js';
import { value, secret } from './support/application.js';

test('operator server inspection uses current typed APIs, dynamic owners and normal cleanup', async scope => {
  const fixture = await operatorFixture(scope);
  await fixture.agent(fixture.admin.actor, 'helper');
  const result = value(await verifyServer(fixture.origin, fixture.account, { agents: 1, names: ['helper'], emptyRooms: true }, new AbortController().signal));
  assert.equal((result as { modelCalls: number }).modelCalls, 0);
  assert(fixture.requests.some(request => request.path === '/_matrix/client/v3/user_directory/search'));
  assert.equal(fixture.requests.filter(request => request.method === 'DELETE').length, 1);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/logout')).length, 1);
  assert.equal((await verifyServer(fixture.origin, fixture.account, { agents: 2 }, new AbortController().signal)).ok, false);
  assert.equal((await verifyServer(fixture.origin, fixture.account, { online: true }, new AbortController().signal)).ok, false);
  fixture.failAgents();
  const failed = await withHuman(fixture.origin, fixture.account, new AbortController().signal, async human => human.client.call(operations.agents, {}, {}));
  assert.equal(failed.ok, false); assert(!JSON.stringify(failed).includes(fixture.admin.token));
  const stop = new AbortController();
  value(await withHuman(fixture.origin, fixture.account, stop.signal, async () => { stop.abort(); return success(true); }));
  fixture.wrongAccount();
  assert.equal((await withHuman(fixture.origin, fixture.account, new AbortController().signal, async () => success(true))).ok, false);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/logout')).length, 6);
  assert.equal(fixture.native.rooms.size, 0);
});

test('operator release verification compares immutable artifact hashes with the deployed manifest', async scope => {
  const fixture = await operatorFixture(scope), directory = mkdtempSync(join(tmpdir(), 'crossfire-release-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(fixture.release.manifest));
  for (const [name, bytes] of Object.entries(fixture.release.files)) writeFileSync(join(directory, name), bytes);
  const result = value(await verifyRelease(fixture.origin, directory, undefined, new AbortController().signal));
  assert.equal(result.release, fixture.release.manifest.release); assert.equal(result.artifacts.length, ARTIFACTS.length);
  writeFileSync(join(directory, 'crossfire-client.mjs'), 'wrong bytes');
  assert.equal((await verifyRelease(fixture.origin, directory, undefined, new AbortController().signal)).ok, false);
  mkdirSync(join(directory, 'missing'));
  assert.equal((await verifyRelease(fixture.origin, join(directory, 'missing'), undefined, new AbortController().signal)).ok, false);
});

test('operator enrollment is read-only until explicit execution and verifies the complete pending introduction', async scope => {
  const fixture = await operatorFixture(scope);
  const enrollmentId = randomUUID(), ownerMatrixId = fixture.account.matrixUserId;
  const introduced = value(await introduceEnrollment(fixture.services, { enrollmentId, claimSecret: secret(), ownerMatrixId,
    fleetKey: 'research', controller: { name: 'laptop', metadata: {} }, instances: [{ instanceKey: 'helper', name: 'helper', coordinationPolicy: defaultCoordinationPolicy() }] }));
  const plan = { enrollmentId, ownerMatrixId, verificationCode: introduced.request.verificationCode, fleetKey: 'research', controllerName: 'laptop',
    instances: [{ instanceKey: 'helper', requestedName: 'helper', coordinationPolicy: defaultCoordinationPolicy() }] };
  value(await reviewEnrollment(fixture.origin, fixture.account, plan, false, new AbortController().signal));
  assert.equal(fixture.requests.filter(request => request.method === 'POST' && request.path.endsWith('/decision')).length, 0);
  for (const changes of [{ ownerMatrixId: '@wrong:test' }, { controllerName: 'wrong' }, { verificationCode: 'WRONGWRONG00' },
    { instances: [{ instanceKey: 'wrong', requestedName: 'helper', coordinationPolicy: defaultCoordinationPolicy() }] },
    { instances: [{ ...plan.instances[0]!, coordinationPolicy: { ...defaultCoordinationPolicy(), permissions: ['room.agent.invite' as const] } }] }]) {
    assert.equal((await reviewEnrollment(fixture.origin, fixture.account, { ...plan, ...changes }, true, new AbortController().signal)).ok, false);
  }
  assert.equal(value(fixture.services.repositories.enrollmentRequest.find({ id: enrollmentId }))?.status, 'pending');
  assert.equal(value(await reviewEnrollment(fixture.origin, fixture.account, plan, true, new AbortController().signal)).approved, true);
  assert.equal(value(fixture.services.repositories.enrollmentRequest.find({ id: enrollmentId }))?.status, 'approved');
  assert.equal((await reviewEnrollment(fixture.origin, fixture.account, plan, true, new AbortController().signal)).ok, false);
  assert.equal(fixture.native.rooms.size, 0);
});
