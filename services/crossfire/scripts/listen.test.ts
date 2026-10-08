import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import test from 'node:test';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { listen, type ListenerOptions } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { fakeCodex, inputReceipt, matrixFixture, message, ROOM, SELF, THREAD, until } from './test-support/listener.js';
import { builtClient, installTestRelease } from './test-support/release.js';

const execute = promisify(execFile);

test('listener long-polls silently, wakes promptly, drains backlog, and checkpoints native acknowledgements', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const controller = new AbortController();
  const options: ListenerOptions = { ...matrix, reconcileMs: 1000, limit: 2, pollMs: 100, debounceMs: 0, runtime: native.runtime };
  const result = listen(options, controller.signal).catch(error => error);
  cleanup(t, async () => { controller.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1 && existsSync(matrix.cursorFile));
  const before = statSync(matrix.cursorFile).mtimeMs;
  await until(() => matrix.requests.filter(request => request.path === API + '/sync').length >= 4);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  assert.equal(statSync(matrix.cursorFile).mtimeMs, before);
  matrix.add(ROOM, message('$self', SELF), ...Array.from({ length: 7 }, (_, index) => message('$' + index)));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '8');
  const inputs = native.requests().filter(request => request.method === 'turn/start');
  const ids = inputs.flatMap(request => {
    const input = request.params!.input as { text: string }[];
    const batch = JSON.parse(input[0]!.text.slice(input[0]!.text.indexOf('\n') + 1));
    return batch.events.map((event: { event_id: string }) => event.event_id);
  });
  assert.deepEqual(ids, Array.from({ length: 7 }, (_, index) => '$' + index));
  const polls = matrix.requests.filter(request => request.path === API + '/sync');
  assert(polls.some(request => request.query.get('timeout') === '100'));
  assert(polls.length >= 4);
  assert(native.requests().every(request => !['thread/start', 'thread/fork'].includes(request.method ?? '')));
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  controller.abort(new Error('test complete'));
  assert.match(String(await result), /test complete/);
});

test('empty acquisition completion releases a blocked backlog reader without waiting for reconciliation', async context => {
  const native = await fakeCodex(context, { mode: 'accepted' });
  const matrix = await matrixFixture(context, native.directory);
  const stop = new AbortController();
  const receiving = listen({ ...matrix, reconcileMs: 120_000, limit: 1, pollMs: 10_000, debounceMs: 0,

    runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(context, async () => { stop.abort(); await receiving; });
  const starts = () => native.requests().filter(request => request.method === 'turn/start');
  await until(() => matrix.waiting() === 1 && existsSync(matrix.cursorFile));
  matrix.add(ROOM, ...[1, 2, 3].map(index => message('$readiness-' + index, undefined, 'x'.repeat(40_000))));
  await until(() => starts().length === 1 && matrix.waiting() === 1);
  const barrier = matrix.hold(API + '/joined_rooms');
  matrix.wake();
  await until(barrier.entered);
  const first = starts()[0]!.params!;
  native.update({ mode: 'normal' });
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(first.clientUserMessageId), first.input) });
  native.notify('thread/status/changed', { threadId: THREAD, status: { type: 'active', activeFlags: [] } });
  await until(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(starts().length, 1);
  barrier.release();
  await until(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '3');
  assert.equal(starts().length, 3);
  for (const request of starts()) assert.equal((request.params!.input as { text: string }[]).length, 1);
});

test('failed and uncertain native deliveries leave cursors untouched and are never automatically retried', async t => {
  for (const mode of ['reject', 'disconnect', 'timeout', 'missing-turn']) {
    const native = await fakeCodex(t, { mode });
    const matrix = await matrixFixture(t, native.directory);
    matrix.add(ROOM, message('$one'));
    writeJson(matrix.cursorFile, { [ROOM]: '0' });
    await assert.rejects(listen({ ...matrix, reconcileMs: 1000, limit: 50, pollMs: 100, debounceMs: 0,
      runtime: (signal, pollMs, hooks) => native.runtime(signal, pollMs, hooks, 500) }, new AbortController().signal));
    assert.deepEqual(JSON.parse(readFileSync(matrix.cursorFile, 'utf8')), { [ROOM]: '0' });
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  }
});

test('native selected-thread closure stops paused acquisition and pending delivery without advancing unread positions', async context => {
  for (const paused of [true, false]) {
    const native = await fakeCodex(context, { mode: 'timeout' });
    const matrix = await matrixFixture(context, native.directory);
    matrix.add(ROOM, message('$unreceived'));
    writeJson(matrix.cursorFile, { [ROOM]: '0' });
    if (paused) writeJson(matrix.cursorFile + '.control', { thread: THREAD, paused: true, controls: [] });
    const rejected = assert.rejects(listen({ ...matrix, reconcileMs: 120_000, limit: 50, pollMs: 10_000, debounceMs: 0,
      runtime: (signal, pollMs, hooks) => native.runtime(signal, pollMs, hooks, 30_000) }, new AbortController().signal), /selected Codex thread closed/);
    await until(() => paused ? matrix.waiting() === 1 : native.requests().some(request => request.method === 'turn/start'));
    native.notify('thread/closed', { threadId: THREAD });
    await rejected;
    assert.deepEqual(JSON.parse(readFileSync(matrix.cursorFile, 'utf8')), { [ROOM]: '0' });
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, paused ? 0 : 1);
    assert.equal(existsSync(matrix.cursorFile + '.ack'), false);
  }
});

test('an incoming message wakes a ten-second long poll without waiting for its timeout', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  const controller = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 120_000, limit: 50, pollMs: 10_000, debounceMs: 100, runtime: native.runtime }, controller.signal).catch(error => error);
  cleanup(t, async () => { controller.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1);
  assert.equal(matrix.requests.filter(request => request.path === API + '/sync' && Number(request.query.get('timeout')) > 0).at(-1)!.query.get('timeout'), '10000');
  matrix.add(ROOM, message('$wake'));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('active-turn acceptance leaves messages unread until native receipt, including interrupted bursts', async context => {
  const native = await fakeCodex(context, { mode: 'accepted' });
  const matrix = await matrixFixture(context, native.directory);
  const controller = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 100, pollMs: 100, debounceMs: 0, runtime: native.runtime }, controller.signal).catch(error => error);
  cleanup(context, async () => { controller.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1 && existsSync(matrix.cursorFile));
  matrix.add(ROOM, message('$first'), message('$second'));
  const starts = () => native.requests().filter(request => request.method === 'turn/start');
  await until(() => starts().length === 1);
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
  native.notify('turn/completed', { threadId: THREAD, turn: { id: 'existing-turn', status: 'interrupted', error: null } });
  await until(() => starts().length === 2);
  assert.deepEqual(starts()[0]!.params, starts()[1]!.params);
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
  const accepted = starts()[1]!.params!;
  native.update({ mode: 'normal' });
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(accepted.clientUserMessageId), accepted.input) });
  await until(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '2');
  assert.equal(starts().length, 2);
  assert(JSON.stringify(starts()[1]!.params!.input).includes('$first'));
  assert(JSON.stringify(starts()[1]!.params!.input).includes('$second'));
});

test('transient Matrix errors retry bounded reads, never replaying acknowledged native inputs', async t => {
  const native = await fakeCodex(t);
  const matrix = await matrixFixture(t, native.directory);
  matrix.failures.set(API + '/sync', [503, 429]);
  matrix.subscribe(ROOM);
  matrix.add(ROOM, message('$one'));
  const controller = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 50, pollMs: 100, debounceMs: 0, runtime: native.runtime }, controller.signal).catch(error => error);
  cleanup(t, async () => { controller.abort(); await result; });
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  matrix.failures.set(API + '/sync', [503, 503, 503, 503]);
  matrix.wake();
  await until(() => (matrix.failures.get(API + '/sync')?.length ?? 0) === 0 && matrix.waiting() === 1);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  matrix.add(ROOM, message('$after-outage'));
  await until(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '2');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 2);
  assert.equal(matrix.maximumWaiting(), 1);
});

test('permanent Matrix errors and suspended ownership stop without native delivery', async t => {
  for (const kind of ['authentication', 'ownership']) {
    const native = await fakeCodex(t);
    const matrix = await matrixFixture(t, native.directory);
    if (kind === 'authentication') matrix.failures.set(API + '/sync', [401]);
    if (kind === 'ownership') matrix.access.ownerStatus = 'suspended';
    matrix.add(ROOM, message('$one', undefined, 'normal'));
    await assert.rejects(listen({ ...matrix, reconcileMs: 1000, limit: 50, pollMs: 100, debounceMs: 0, runtime: native.runtime }, new AbortController().signal),
      kind === 'authentication' ? /HTTP 401/ : /Agent and owner must be active/);
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
    assert.equal(existsSync(matrix.cursorFile), false);
  }
});

test('controller-owned receiver shares one private host with intentional tools and rejects duplicate ownership', async scope => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory), stop = new AbortController();
  const client = installTestRelease(native.directory);
  writeFileSync(join(native.directory, 'package.json'), '{"type":"commonjs"}');
  const running = listen({ ...matrix, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 100 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await running; });
  const args = [client, '--project', matrix.workspace, '--profile', 'watson'];
  const command = (...arguments_: string[]) => execute(process.execPath, [...args, ...arguments_], { env: matrix.env, cwd: native.directory, timeout: 10000 });
  await until(() => matrix.waiting() === 1);
  assert.equal(matrix.host.size(), 1);
  assert.deepEqual(JSON.parse((await command('agent', 'read')).stdout).events, []);
  assert.equal(matrix.maximumWaiting(), 1);
  await assert.rejects(listen({ ...matrix, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 100 }, stop.signal), /already owns this private state/u);
  const who = await command('matrix', 'get-joined-members-by-room', '--room-id', ROOM);
  assert(JSON.parse(who.stdout).joined[SELF]);
  matrix.add(ROOM, message('$one'));
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert(!existsSync(join(native.directory, 'node_modules')), 'Managed intentional client artifacts are self-contained');
  stop.abort(new Error('Controller receiver stopped'));
  assert.match(String(await running), /Controller receiver stopped/u);
  assert.equal(matrix.host.size(), 0);
  await assert.rejects(command('agent', 'read'), /controller|listener|receiver/iu, 'Unread queries cannot silently start an independent receiver');
  await (await acquireProcessLock(join(matrix.workspace, '.crossfire/state/watson/receiver')))();
});

test('removed standalone lifecycle commands are rejected before network or native work', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory);
  const client = builtClient(), args = [client, '--project', fixture.workspace, '--profile', 'watson'];
  for (const command of ['connect', 'disconnect', 'listen', 'run', 'attach', 'enroll', 'setup']) {
    await assert.rejects(execute(process.execPath, [...args, 'agent', command], { env: fixture.env, timeout: 10000 }), /Unknown command/u);
  }
  for (const option of ['--thread', '--runtime', '--endpoint', '--debounce-ms']) {
    await assert.rejects(execute(process.execPath, [...args, 'agent', 'read', option, 'invalid'], { env: fixture.env, timeout: 10000 }), /Unsupported option|Unknown option/u);
  }
  assert.equal(native.requests().length, 0); assert.equal(fixture.requests.length, 0);
});
