import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createListenerControl, controlledPublisher } from '@ctlflow/crossfire-agent-core/listener-control';
import type { HistoryQueries } from '@ctlflow/crossfire-agent-core/history-query';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import type { ControllerBinding } from '@ctlflow/crossfire-agent-core/listener-control-port';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { fakeCodex, matrixFixture, message, ROOM, until, CONTROLLER } from '../scripts/test-support/listener.js';
import { withClock } from '../scripts/test-support/clock.js';
import { createListenerBudget } from '@ctlflow/crossfire-agent-core/budget';

test('pausing delivery cancels only input admission while connection loss cancels reporting too', () => {
  const binding = createListenerControl(async () => {}, () => CONTROLLER);
  assert.equal(binding.connection.current().connected, false);
  binding.update({ connected: true, active: true, input: null });
  const first = binding.connection.current();
  binding.update({ connected: true, active: false, input: null });
  assert.equal(first.signal.aborted, true); assert.equal(first.connection.aborted, false);
  assert.equal(binding.connection.current().connection, first.connection);
  binding.update({ connected: true, active: true, input: null });
  const resumed = binding.connection.current();
  assert.notEqual(resumed.signal, first.signal); assert.equal(resumed.connection, first.connection);
  binding.close();
  assert.equal(resumed.signal.aborted, true); assert.equal(resumed.connection.aborted, true);
  assert.throws(() => binding.update({ connected: false, active: true, input: null }), /Delivery requires/);
  assert.equal(binding.connection.current().active, false);
  binding.update({ connected: true, active: false, input: null });
  assert.notEqual(binding.connection.current().connection, first.connection);
  assert.equal(binding.connection.current().connection.aborted, false); binding.close();
});

test('listener activity receipts retain the exact submitted controller capability across HTTP lease turnover', async scope => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory), stop = new AbortController();
  let current = { ...CONTROLLER }, submitted = false;
  const binding = createListenerControl(async () => {}, () => current);
  binding.update({ connected: true, active: true, input: null });
  const receipts: { runId: string; binding: ControllerBinding }[] = [];
  const coordination = { ...matrix.coordination, report: async (...parameters: Parameters<typeof matrix.coordination.report>) => {
    const response = await matrix.coordination.report(...parameters);
    if (!submitted) { submitted = true; current = { ...CONTROLLER, connectionId: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee' }; }
    return response;
  } };
  let failed: unknown;
  const receiving = listen({ ...matrix, coordination, control: binding.connection, runtime: native.runtime,
    reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20,
    activity: (runId, controller) => receipts.push({ runId, binding: controller }),
  }, stop.signal).catch(error => { failed = error; return error; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => { if (failed) throw failed; return receipts.length === 1; });
  assert.notDeepEqual(current, CONTROLLER);
  assert.deepEqual(receipts[0]!.binding, CONTROLLER, 'Receipt binds to the lease accepted by the activity request, not a later controller getter');
  const report = matrix.requests.find(request => request.path.endsWith('/listener-runs/' + receipts[0]!.runId));
  assert.deepEqual((report?.body as { controller: ControllerBinding }).controller, receipts[0]!.binding);
});

test('fleet gate pauses one receiver, cancels pending publication and retains unread/native identity', withClock(async (scope, clock) => {

  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => CONTROLLER); binding.update({ connected: true, active: true, input: null });
  const activityRuns: string[] = [];
  const running = listen({ ...matrix, activity: runId => activityRuns.push(runId), control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 500, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(running); });
  await clock.until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$one'));
  binding.update({ connected: false, active: false, input: null });
  await clock.advance(700);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert.equal(matrix.requests.filter(request => request.path.includes('/listener-runs/')).at(-1)?.body && (matrix.requests.filter(request => request.path.includes('/listener-runs/')).at(-1)!.body as { stopped: boolean }).stopped, true);
  binding.update({ connected: true, active: true, input: null });
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 1);
  await clock.until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  binding.update({ connected: false, active: false, input: null });
  await clock.advance(150);
  matrix.add(ROOM, message('$two')); await clock.advance(200);
  binding.update({ connected: true, active: true, input: null });
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 2);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert(matrix.maximumWaiting() <= 1, 'Activation never starts another receiver');
  assert.equal(activityRuns.length, 3); assert.equal(new Set(activityRuns).size, 3, 'Each activation reports its exact authenticated listener run');
  for (const runId of activityRuns) assert(matrix.requests.some(request => request.path.endsWith('/listener-runs/' + runId)
    && !(request.body as { stopped: boolean }).stopped), 'Run callbacks follow successful initial activity reporting');
}));

test('pause releases a restored empty publication so explicit unread tools retain their cursor authority', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => CONTROLLER); binding.update({ connected: true, active: true, input: null });
  const publication = matrix.cursorFile + '.chat-publication';
  writeJson(publication, { mode: 'shared', batch: { events: [], cursors: { [ROOM]: 'never-committed' }, more_rooms: [], latest: {} }, identities: [], steps: [] });
  let queries: HistoryQueries | undefined;
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20,
    ready: (_test, selected) => { queries = selected; binding.update({ connected: false, active: false, input: null }); } }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(running); });
  await clock.until(() => queries !== undefined && !existsSync(publication));
  assert.equal(existsSync(matrix.cursorFile), false, 'Releasing unsent work cannot consume a Matrix cursor');
  matrix.add(ROOM, message('$manual-unread'));
  const read = await queries!.read({ kind: 'unread', room: ROOM, limit: 100, outputBytes: 4096, direction: 'f', cursors: { entries: [] } });
  assert(read.ok); assert(read.value.text.includes('$manual-unread')); assert(read.value.queryId);
  assert((await queries!.acknowledge(read.value.queryId)).ok);
  binding.update({ connected: true, active: true, input: null }); await clock.until(() => matrix.waiting() === 1);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0, 'Explicitly read input is not replayed on resume');
}));

test('rapid controller lease turnover rebinds immutable activity runs without replacing the receiver or native history', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => matrix.reporting.controller); binding.update({ connected: true, active: true, input: null });
  const receipts: { runId: string; binding: ControllerBinding }[] = [];
  let finished = false;
  const receiving = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20,
    activity: (runId, controller) => receipts.push({ runId, binding: controller }),
  }, stop.signal).catch(error => error).finally(() => { finished = true; });
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
  await clock.until(() => receipts.length === 1 && matrix.waiting() === 1);
  binding.update({ connected: false, active: false, input: null });
  matrix.reporting.controller = { ...CONTROLLER, connectionId: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee' };
  binding.update({ connected: true, active: true, input: null });
  await clock.until(() => receipts.length === 2, 'A new lease requires a new activity run even when pause and resume coalesce');
  assert.equal(finished, false); assert.deepEqual(receipts[0]!.binding, CONTROLLER); assert.deepEqual(receipts[1]!.binding, matrix.reporting.controller);
  assert.notEqual(receipts[0]!.runId, receipts[1]!.runId);
  const stopped = matrix.requests.find(request => request.path.endsWith('/listener-runs/' + receipts[0]!.runId) && (request.body as { stopped: boolean }).stopped);
  assert.deepEqual((stopped?.body as { controller: ControllerBinding }).controller, CONTROLLER);
  matrix.add(ROOM, message('$after-turnover'));
  await clock.until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1); assert(matrix.maximumWaiting() <= 1);
}));

test('controller cancellation while queued for publication keeps the receiver alive and unread work resumable', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const budget = createListenerBudget(), release = await Promise.all(Array.from({ length: 8 }, () => budget.acquire('publication', stop.signal)));
  let queued = 0, finished = false;
  matrix.host.budget.acquire = async (kind, signal) => { if (kind === 'publication') queued++; return budget.acquire(kind, signal); };
  const binding = createListenerControl(async () => {}, () => CONTROLLER); binding.update({ connected: true, active: true, input: null });
  const receiving = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal)
    .catch(error => error).finally(() => { finished = true; });
  cleanup(scope, async () => { release.forEach(unlock => unlock()); stop.abort(); await clock.complete(receiving); });
  await clock.until(() => queued > 0);
  binding.update({ connected: false, active: false, input: null }); await clock.advance(10);
  assert.equal(finished, false, 'Canceling queued work is not a listener failure');
  matrix.add(ROOM, message('$queued-unread')); release.forEach(unlock => unlock()); binding.update({ connected: true, active: true, input: null });
  await clock.until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
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
  matrix.joined.delete(ROOM); matrix.waking.policy = 'selected'; matrix.waking.senders = [];
  const receipts: string[] = [];
  let ended: unknown;
  const binding = createListenerControl(async id => { receipts.push(id); binding.update({ connected: true, active: true, input: null }); }, () => CONTROLLER);
  binding.update({ connected: true, active: true, input: null });
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => { ended = error; return error; });
  cleanup(scope, async () => { stop.abort(); await running; });
  await until(() => { if (ended) throw ended; return matrix.waiting() === 1; });
  binding.update({ connected: true, active: true, input: { messageId: 'direct-task', text: 'Owner fleet task\n{"body":"Multiline native envelope"}', expiresAt: Date.now() + 10000 } });
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
  const binding = createListenerControl(async () => { if (fail) throw Error('Lost receipt response'); binding.update({ connected: true, active: true, input: null }); }, () => CONTROLLER);
  const text = 'Complete fleet task. '.repeat(500);
  binding.update({ connected: true, active: true, input: { messageId: 'message', text, expiresAt: Date.now() + 10000 } });
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
  binding.update({ connected: true, active: true, input: { messageId: 'expired', text: 'Expired task', expiresAt: 1 } });
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

test('steering preempts controller receipt waits without replaying accepted native input or dropping its checkpoint', async () => {
  const values = new Map<string, unknown>(), submitted: string[] = [], acknowledged: string[] = [];
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  const preemption = new AbortController(); let blocked = true, attempted!: () => void;
  const waiting = new Promise<void>(resolve => { attempted = resolve; });
  const binding = createListenerControl(async (_id, _status, _error, signal) => {
    if (blocked) {
      assert(signal); attempted();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    binding.update({ connected: true, active: true, input: null });
  }, () => CONTROLLER);
  binding.update({ connected: true, active: true, input: { messageId: 'preempted', text: 'Retain native receipt', expiresAt: Date.now() + 10000 } });
  const runtime: RuntimeConnection = { sessionId: 'native-session', approval: 'none', signal: new AbortController().signal,
    deliver: async (_text, id) => { submitted.push(id); }, recover: async () => false, acknowledge: ids => { acknowledged.push(...ids); },
    inspect: async () => ({ busy: false }), settle: async () => false, close: () => {} };
  const publisher = controlledPublisher({ storage, file: 'checkpoint', control: binding.connection, runtime, artifacts: messageArtifacts(storage, 'messages', Date.now), maximum: 4096 });
  const publishing = publisher.publish(preemption.signal), rejected = assert.rejects(publishing, /Steering preemption/u);
  await waiting; preemption.abort(new Error('Steering preemption')); await rejected;
  assert.equal(storage.read<{ stage: string }>('checkpoint').stage, 'delivered'); assert.deepEqual(acknowledged, []);
  blocked = false; await publisher.publish(runtime.signal);
  assert.deepEqual(submitted, ['preempted']); assert.deepEqual(acknowledged, ['preempted']); assert(!publisher.pending());
});

test('every listener waits for its owning controller and no direct receiver can bypass its disabled delivery', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const binding = createListenerControl(async () => {}, () => CONTROLLER);
  const running = listen({ ...matrix, control: binding.connection, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(running); });
  await clock.advance(1000);
  assert.equal(matrix.requests.length, 0, 'Inactive controllers cannot acquire room history or agent policy');
  assert.equal(native.requests().length, 0, 'Inactive controllers cannot connect or launch native conversations');
  binding.update({ connected: true, active: true, input: null });
  await clock.until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$controlled'));
  await clock.until(() => native.requests().filter(request => request.method === 'turn/start').length === 1);
  const report = matrix.requests.find(request => request.path.includes('/listener-runs/') && !request.path.endsWith('/runtime'));
  assert.deepEqual((report?.body as { controller: unknown }).controller, CONTROLLER);
  assert.equal(Object.hasOwn(report?.body as object, 'controllerBound'), false);
}));
