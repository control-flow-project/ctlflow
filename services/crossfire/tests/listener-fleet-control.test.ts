import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createListenerControl, controlledPublisher } from '@crossfire/agent-core/listener-control';
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
  const values = new Map<string, unknown>(), submitted: string[] = [], acked: string[] = [];
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  let fail = true;
  const binding = createListenerControl(async () => { if (fail) throw Error('Lost receipt response'); binding.update({ active: true, input: null }); });
  binding.update({ active: true, input: { messageId: 'message', text: 'Fleet task', expiresAt: Date.now() + 10000 } });
  const runtime: RuntimeConnection = { sessionId: 'same-session', approval: 'none', signal: new AbortController().signal,
    deliver: async (_text, id) => { submitted.push(id); }, recover: async () => false, acknowledge: ids => { acked.push(...ids); }, inspect: async () => ({ busy: false }), settle: async () => false, close: () => {} };
  const publisher = () => controlledPublisher(storage, 'checkpoint', binding.connection, runtime);
  await assert.rejects(publisher().publish(runtime.signal), /Lost receipt/);
  assert.deepEqual(submitted, ['message']); assert.deepEqual(acked, []);
  fail = false; await publisher().publish(runtime.signal);
  assert.deepEqual(submitted, ['message']); assert.deepEqual(acked, ['message']); assert.equal(values.size, 0);
  binding.update({ active: true, input: { messageId: 'expired', text: 'Expired task', expiresAt: 1 } });
  await publisher().publish(runtime.signal); assert.deepEqual(submitted, ['message']);
  values.set('checkpoint', { sessionId: 'other-session', input: { messageId: 'x', text: 'x', expiresAt: 1 }, stage: 'publishing' });
  await assert.rejects(publisher().publish(runtime.signal), /retargeted/);
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
