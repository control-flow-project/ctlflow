import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { testListener } from '@ctlflow/crossfire-agent-core/diagnostic';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { listenerRequest } from '@ctlflow/crossfire-adapter-crossfire/listener-client';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { matrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { success, failure } from '@ctlflow/crossfire-kernel/result';
import { fakeCodex, matrixFixture, THREAD, until } from '../scripts/test-support/listener.js';
test('listener diagnostics distinguish live readiness, no rooms, nobody policy, pause and inactive authority without prompts or read markers', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory), stop = new AbortController();
  const runtime = await native.runtime(stop.signal, 100);
  cleanup(scope, () => runtime.close());
  const transport = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token, signal: stop.signal, timeoutMs: 1000 });
  const options = { coordination: fixture.coordination, runtime, matrix: transport, id: fixture.id, owner: fixture.settings.owner,
    matrixUserId: fixture.account.user_id, paused: false, signal: stop.signal };
  const ready = await testListener(options);
  assert.equal(ready.session, THREAD);
  assert.equal(ready.canReceiveRoomTasks, true);
  const { turnControl: _controls, ...withoutControl } = runtime;
  assert.equal((await testListener({ ...options, runtime: withoutControl })).busy, false, 'Native inspection is independent of interruption support');
  assert.equal((await testListener({ ...options, paused: true })).canReceiveRoomTasks, false);
  fixture.waking.senders = []; fixture.waking.policy = 'nobody';
  const nobody = await testListener(options);
  assert.equal(nobody.canReceiveRoomTasks, false);
  assert.equal(nobody.wakeMode, 'nobody');
  fixture.joined.clear();
  const empty = await testListener(options);
  assert.equal(empty.rooms, 0);
  assert.equal(empty.canReceiveRoomTasks, false);
  assert(empty.message.includes('No unmuted rooms'));
  fixture.access.ownerStatus = 'suspended';
  await assert.rejects(testListener(options), /inactive/);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert(!fixture.requests.some(request => request.path.endsWith('/read_markers')));
  await runtime.close();
  await assert.rejects(testListener(options), /stopped|closed|disconnect/i);
});

test('real shared-host readiness verifies on-request approval without creating owner chats, publishing input or waking another history', async scope => {
  const native = await fakeCodex(scope, { approvalPolicy: 'on-request' }), fixture = await matrixFixture(scope, native.directory);
  fixture.joined.clear();
  const stop = new AbortController(); let ready = false, failure: unknown;
  const receiving = listen({ ...fixture, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 100,
    ready: () => { ready = true; } }, stop.signal).catch(error => { failure = error; return error; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => { if (failure) throw failure; return ready && fixture.waiting() === 1 && existsSync(fixture.cursorFile); });
  const cursor = () => [fixture.cursorFile, fixture.cursorFile + '.sync'].map(file => existsSync(file) ? readFileSync(file, 'utf8') : null);
  const before = cursor(), resumes = native.requests().filter(request => request.method === 'thread/resume').length;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tested = await listenerRequest(dirname(fixture.cursorFile), { action: 'test' });
    assert(tested?.ok); assert(tested.value.ready); assert.equal(tested.value.test?.approval, 'listener');
    assert.equal(tested.value.test?.rooms, 0); assert.equal(tested.value.test?.authenticated, true);
    assert.equal(tested.value.test?.session, THREAD);
  }
  assert.deepEqual(cursor(), before, 'Readiness diagnostics never acknowledge or rewrite unread positions');
  assert.equal(fixture.joined.size, 0);
  assert.equal(fixture.requests.some(request => request.path.endsWith('/owner-conversation')), false);
  assert.equal(fixture.requests.some(request => request.path.endsWith('/read_markers')), false);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, resumes);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert.equal(failure, undefined);
});

test('diagnostics verify native approval readiness without executing a model turn', async scope => {
  const native = await fakeCodex(scope, { approvalPolicy: 'on-request' });
  const fixture = await matrixFixture(scope, native.directory), stop = new AbortController();
  const runtime = await native.runtime(stop.signal, 100);
  cleanup(scope, () => runtime.close());
  const options = { coordination: fixture.coordination, runtime,
    matrix: matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token, signal: stop.signal, timeoutMs: 1000 }),
    id: fixture.id, owner: fixture.settings.owner, matrixUserId: fixture.account.user_id, paused: false, signal: stop.signal };
  await assert.rejects(testListener(options), /owner DM approval broker is not connected/);
  const ready = await testListener({ ...options, authorizeApproval: async () => success(undefined) });
  assert.equal(ready.approval, 'listener');
  await assert.rejects(testListener({ ...options, authorizeApproval: async () => failure('forbidden', 'Room access was removed') }), /Room access was removed/);
  assert.equal(native.requests().some(request => request.method === 'turn/start'), false);
});
