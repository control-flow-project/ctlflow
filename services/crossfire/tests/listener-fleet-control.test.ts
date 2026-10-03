import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createListenerControl, controlledPublisher } from '@crossfire/agent-core/listener-control';
import { messageArtifacts } from '@crossfire/agent-core/message-artifacts';
import type { LocalState } from '@crossfire/agent-core/port';
import type { RuntimeConnection } from '@crossfire/agent-core/runtime';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { fakeCodex, matrixFixture, message, ROOM, until } from '../scripts/test-support/listener.js';
import { withClock } from '../scripts/test-support/clock.js';

test('fleet gate pauses one receiver, cancels pending publication and retains unread/native identity', withClock(async (scope, clock) => {

  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}); binding.update({ active: true, input: null });
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 500, limit: 20 }, stop.signal).catch(error => error);
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
}));

test('controller messages bypass room wake filtering without consuming room cursors', async scope => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory), stop = new AbortController();
  matrix.joined.delete(ROOM); matrix.waking.policy = 'nobody'; matrix.waking.senders = [];
  const receipts: string[] = [];
  let ended: unknown;
  const binding = createListenerControl(async id => { receipts.push(id); binding.update({ active: true, input: null }); });
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
  const binding = createListenerControl(async () => { if (fail) throw Error('Lost receipt response'); binding.update({ active: true, input: null }); });
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
  const binding = createListenerControl(async (id, status) => { receipts.push(id + ':' + status); });
  const runtime: RuntimeConnection = { sessionId: 'native-session', approval: 'none', signal: new AbortController().signal,
    deliver: async () => { assert.fail('Receipt recovery must not submit input'); }, recover: async (text, id) => { assert.equal(text, 'Exact input'); recovered.push(id); return true; },
    acknowledge: ids => { assert.deepEqual(ids, ['accepted']); }, inspect: async () => ({ busy: false }), settle: async () => false, close: () => {} };
  await controlledPublisher({ storage, file: 'checkpoint', control: binding.connection, runtime, artifacts: messageArtifacts(storage, 'messages', Date.now), maximum: 4096 }).publish(runtime.signal);
  assert.deepEqual(recovered, ['accepted']); assert.deepEqual(receipts, ['accepted:delivered']); assert(!storage.exists('checkpoint'));
});

test('direct listeners remain independent when the same agent’s fleet-bound listener is inactive', async scope => {
  const native = await fakeCodex(scope), direct = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory), stop = new AbortController();
  const binding = createListenerControl(async () => {});
  const bound = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  const standalone = listen({ ...matrix, cursorFile: join(direct.directory, 'cursor.json'), runtime: direct.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await bound; await standalone; });
  await until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$direct'));
  await until(() => direct.requests().filter(request => request.method === 'turn/start').length === 1);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});
