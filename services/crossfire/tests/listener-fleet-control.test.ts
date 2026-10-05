import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createListenerControl, controlledPublisher } from '@ctlflow/crossfire-agent-core/listener-control';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { fakeCodex, matrixFixture, message, ROOM, until, CONTROLLER } from '../scripts/test-support/listener.js';
import { withClock } from '../scripts/test-support/clock.js';

test('fleet gate pauses one receiver, cancels pending publication and retains unread/native identity', withClock(async (scope, clock) => {

  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => CONTROLLER); binding.update({ active: true, input: null });
  const activityRuns: string[] = [];
  const running = listen({ ...matrix, activity: runId => activityRuns.push(runId), control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 500, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(running); });
  await clock.until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$one'));
  binding.update({ active: false, input: null });
  await clock.advance(700);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert.equal(matrix.requests.filter(request => request.path.includes('/listener-runs/')).at(-1)?.body && (matrix.requests.filter(request => request.path.includes('/listener-runs/')).at(-1)!.body as { stopped: boolean }).stopped, true);
  binding.update({ active: true, input: null });
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 1);
  await clock.until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  binding.update({ active: false, input: null });
  await clock.advance(150);
  matrix.add(ROOM, message('$two')); await clock.advance(200);
  binding.update({ active: true, input: null });
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 2);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert(matrix.maximumWaiting() <= 1, 'Activation never starts another receiver');
  assert.equal(activityRuns.length, 3); assert.equal(new Set(activityRuns).size, 3, 'Each activation reports its exact authenticated listener run');
  for (const runId of activityRuns) assert(matrix.requests.some(request => request.path.endsWith('/listener-runs/' + runId)
    && !(request.body as { stopped: boolean }).stopped), 'Run callbacks follow successful initial activity reporting');
}));

test('controller listener timing and page bounds are validated before native or network work', async scope => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory);
  for (const field of ['pollMs', 'debounceMs', 'reconcileMs', 'limit'] as const) {
    const invalid = field === 'pollMs' ? [0, 99, 30001, NaN, Infinity, 0.5]
      : field === 'debounceMs' ? [-1, 60001, NaN, Infinity, 0.5]
      : field === 'reconcileMs' ? [999, 600001, NaN, Infinity, 0.5] : [0, 101, NaN, Infinity, 0.5];
    for (const value of invalid) await assert.rejects(listen({ ...matrix, runtime: native.runtime,
      reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20, [field]: value }, new AbortController().signal), /Listener.*must/u);
  }
  assert.equal(native.requests().length, 0); assert.equal(matrix.requests.length, 0); assert.equal(matrix.host.size(), 0);
});

test('controller messages bypass room wake filtering without consuming room cursors', async scope => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory), stop = new AbortController();
  matrix.joined.delete(ROOM); matrix.waking.policy = 'nobody'; matrix.waking.senders = [];
  const receipts: string[] = [];
  let ended: unknown;
  const binding = createListenerControl(async id => { receipts.push(id); binding.update({ active: true, input: null }); }, () => CONTROLLER);
  binding.update({ active: true, input: null });
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => { ended = error; return error; });
  cleanup(scope, async () => { stop.abort(); await running; });
  await until(() => { if (ended) throw ended; return matrix.waiting() === 1; });
  binding.update({ active: true, input: { messageId: 'direct-task', text: 'Owner fleet task\n{"body":"Multiline native envelope"}', expiresAt: Date.now() + 10000 } });
  await until(() => receipts.length === 1);
  assert.deepEqual(receipts, ['direct-task']);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert.equal(Object.hasOwn(existsSync(matrix.cursorFile) ? JSON.parse(readFileSync(matrix.cursorFile, 'utf8')) : {}, ROOM), false);
});

test('controller checkpoint retries only receipts after native acceptance and rejects session retargeting', async () => {
  const values = new Map<string, unknown>(), submitted: string[] = [], inputs: string[] = [], acked: string[] = [];
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  let fail = true;
  const binding = createListenerControl(async () => { if (fail) throw Error('Lost receipt response'); binding.update({ active: true, input: null }); }, () => CONTROLLER);
  const text = 'Complete fleet task. '.repeat(500);
  binding.update({ active: true, input: { messageId: 'message', text, expiresAt: Date.now() + 10000 } });
  const runtime: RuntimeConnection = { sessionId: 'same-session', approval: 'none', signal: new AbortController().signal,
    deliver: async (input, id) => { submitted.push(id); inputs.push(input); }, recover: async () => false, acknowledge: ids => { acked.push(...ids); }, inspect: async () => ({ busy: false }), settle: async () => false, close: () => {} };
  const publisher = () => controlledPublisher({ storage, file: 'checkpoint', control: binding.connection, runtime, artifacts: messageArtifacts(storage, 'messages', Date.now), maximum: 4096 });
  await assert.rejects(publisher().publish(runtime.signal), /Lost receipt/);
  assert.deepEqual(submitted, ['message']); assert.deepEqual(acked, []);
  assert(Buffer.byteLength(inputs[0]!) <= 4096);
  const pointer = JSON.parse(inputs[0]!.split('\n')[1]!) as { kind: string; file: string };
  assert.equal(pointer.kind, 'crossfire-input-file'); assert.equal(storage.read<{ text: string }>(pointer.file).text, text);
  fail = false; await publisher().publish(runtime.signal);
  assert.deepEqual(submitted, ['message']); assert.deepEqual(acked, ['message']); assert(!values.has('checkpoint'));
  assert(storage.exists(pointer.file), 'Settled input files remain available for their retention period');
  binding.update({ active: true, input: { messageId: 'expired', text: 'Expired task', expiresAt: 1 } });
  await publisher().publish(runtime.signal); assert.deepEqual(submitted, ['message']);
  values.set('checkpoint', { sessionId: 'other-session', input: { messageId: 'x', text: 'x', expiresAt: 1 }, text: 'x', stage: 'publishing' });
  await assert.rejects(publisher().publish(runtime.signal), /retargeted/);
});

test('expired controller input recovers its exact accepted receipt rather than dropping or resubmitting it', async () => {
  const values = new Map<string, unknown>(), receipts: string[] = [], recovered: string[] = [];
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  values.set('checkpoint', { sessionId: 'native-session', input: { messageId: 'accepted', text: 'Exact input', expiresAt: 1 }, text: 'Exact input', stage: 'publishing' });
  const binding = createListenerControl(async (id, status) => { receipts.push(id + ':' + status); }, () => CONTROLLER);
  const runtime: RuntimeConnection = { sessionId: 'native-session', approval: 'none', signal: new AbortController().signal,
    deliver: async () => { assert.fail('Receipt recovery must not submit input'); }, recover: async (text, id) => { assert.equal(text, 'Exact input'); recovered.push(id); return true; },
    acknowledge: ids => { assert.deepEqual(ids, ['accepted']); }, inspect: async () => ({ busy: false }), settle: async () => false, close: () => {} };
  await controlledPublisher({ storage, file: 'checkpoint', control: binding.connection, runtime, artifacts: messageArtifacts(storage, 'messages', Date.now), maximum: 4096 }).publish(runtime.signal);
  assert.deepEqual(recovered, ['accepted']); assert.deepEqual(receipts, ['accepted:delivered']); assert(!storage.exists('checkpoint'));
});

test('every listener waits for its owning controller and no direct receiver can bypass its disabled delivery', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => CONTROLLER);
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(running); });
  await clock.advance(1000);
  assert.equal(matrix.requests.length, 0, 'Inactive controllers cannot acquire room history or agent policy');
  assert.equal(native.requests().length, 0, 'Inactive controllers cannot connect or launch native conversations');
  binding.update({ active: true, input: null });
  await clock.until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$controlled'));
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 1);
  const report = matrix.requests.find(request => request.path.includes('/listener-runs/') && !request.path.endsWith('/runtime'));
  assert.deepEqual((report?.body as { controller: unknown }).controller, CONTROLLER);
  assert.equal(Object.hasOwn(report?.body as object, 'controllerBound'), false);
}));
