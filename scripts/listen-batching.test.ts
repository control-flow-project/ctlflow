import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { API, readJson } from '../skills/conduit-chat/scripts/lib.ts';
import { listen, type ListenerOptions } from '../skills/conduit-chat/scripts/listen.ts';
import type { ReceivedEvent } from '../skills/conduit-chat/scripts/receive.ts';
import { ROOT } from './instance.ts';
import { fakeCodex, inputReceipt, matrixFixture, message, ROOM, SELF, THREAD, until } from './test-support/listener.ts';

const PLANNING = '!planning:test.localhost';

function submissions(native: Awaited<ReturnType<typeof fakeCodex>>) {
  return native.requests().filter(request => request.method === 'turn/start');
}

function content(native: Awaited<ReturnType<typeof fakeCodex>>) {
  return submissions(native).map(request => {
    const input = request.params!.input as { text: string }[];
    assert.equal(input.length, 1);
    const text = input[0].text;
    assert(Buffer.byteLength(text) <= 128 * 1024);
    return (JSON.parse(text.slice(text.indexOf('\n') + 1)) as { events: ReceivedEvent[] }).events;
  });
}

async function fixture(context: TestContext,
  controls: Partial<Pick<ListenerOptions, 'debounceMs' | 'pollMs' | 'limit' | 'room'>> = {}, accepted = false) {
  const native = await fakeCodex(context, { mode: accepted ? 'accepted' : 'normal' });
  const matrix = await matrixFixture(context, native.directory);
  const stop = new AbortController();
  const options: ListenerOptions = { ...matrix, limit: 50, pollMs: 100, debounceMs: 500,
    ...controls, codex: native.options };
  const result = listen(options, stop.signal).catch((error: unknown) => error);
  context.after(async () => { stop.abort(new Error('test complete')); await result; });
  await until(() => matrix.waiting() === 1);
  const cursors = () => readJson<Record<string, string>>(matrix.cursorFile);
  return { native, matrix, stop, options, result, cursors };
}

test('the leading input is immediate and continuous cross-room traffic shares a fixed trailing window', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  const started = performance.now();
  matrix.add(ROOM, message('$first'));
  await until(() => cursors()[ROOM] === '1');
  assert(performance.now() - started < 700, 'the first input must not wait for a window');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$first']]);
  matrix.joined.add(PLANNING);
  matrix.add(PLANNING, message('$planning'));
  matrix.add(ROOM, message('$second'));
  const created = ['$second'];
  const producer = setInterval(() => {
    const id = '$continued-' + created.length;
    created.push(id);
    matrix.add(ROOM, message(id));
  }, 40);
  context.after(() => clearInterval(producer));
  await delay(200);
  assert.equal(submissions(native).length, 1);
  assert.equal(cursors()[ROOM], '1');
  assert.equal(cursors()[PLANNING], undefined);
  await until(() => submissions(native).length === 2 && Number(cursors()[ROOM]) > 1);
  clearInterval(producer);
  const trailing = content(native)[1];
  const roomEvents = trailing.filter(event => event.room_id === ROOM).map(event => event.event_id);
  assert(roomEvents.length >= 5);
  assert.deepEqual(roomEvents, created.slice(0, roomEvents.length));
  assert.deepEqual(trailing.filter(event => event.room_id === PLANNING).map(event => event.event_id), ['$planning']);
  assert.deepEqual(cursors(), { [ROOM]: String(roomEvents.length + 1), [PLANNING]: '1' });
});

test('the CLI defaults to ten seconds and accepts a shorter configured window', { timeout: 25_000 }, async context => {
  for (const debounceMs of [undefined, 500]) {
    await context.test(debounceMs === undefined ? 'default 10000ms' : 'configured 500ms', async childContext => {
      const native = await fakeCodex(childContext);
      const matrix = await matrixFixture(childContext, native.directory);
      const args = [join(ROOT, 'skills/conduit-chat/scripts/chat.ts'), '--instance', 'test', '--agent', 'watson',
        'listen', '--thread', THREAD, '--codex-binary', native.options.binary, '--poll-ms', '100',
        ...(debounceMs === undefined ? [] : ['--debounce-ms', String(debounceMs)])];
      const child = spawn(process.execPath, args, { env: matrix.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const stopped = once(child, 'close');
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += String(chunk); });
      child.stderr.on('data', chunk => { errors += String(chunk); });
      childContext.after(async () => { child.kill('SIGTERM'); await stopped; });
      await until(() => matrix.waiting() === 1);
      const started = performance.now();
      matrix.add(ROOM, message('$first'));
      await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '1');
      matrix.add(ROOM, message('$second'), message('$third'));
      await delay(debounceMs === undefined ? 9000 : 150);
      assert.equal(submissions(native).length, 1);
      assert.equal(readJson<Record<string, string>>(matrix.cursorFile)[ROOM], '1');
      await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '3');
      const elapsed = performance.now() - started;
      assert(elapsed >= (debounceMs ?? 10000), 'the window must not close early');
      assert(elapsed < (debounceMs ?? 10000) + 2000, 'the window must not restart on later arrivals');
      assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$first'], ['$second', '$third']]);
      child.kill('SIGTERM');
      assert.deepEqual(await stopped, [0, null]);
      assert.equal(output, '');
      assert.equal(errors, '');
    });
  }
});

test('waiting for native receipt overlaps the window and never checkpoints unreceived input', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 1000 }, true);
  matrix.add(ROOM, message('$pending-receipt'));
  await until(() => submissions(native).length === 1);
  matrix.add(ROOM, message('$during-receipt'));
  await delay(1200);
  assert.equal(submissions(native).length, 1);
  assert.equal(cursors()[ROOM], '0');
  const accepted = submissions(native)[0].params!;
  native.update({ mode: 'normal' });
  const released = performance.now();
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(accepted.clientUserMessageId), accepted.input) });
  await until(() => cursors()[ROOM] === '2');
  assert(performance.now() - released < 1000, 'receipt must not start another window');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$pending-receipt'], ['$during-receipt']]);
});

test('cancelling a window preserves unread messages for an immediate restart', async context => {
  const { native, matrix, stop, options, result, cursors } = await fixture(context, { debounceMs: 1000 });
  matrix.add(ROOM, message('$received'));
  await until(() => cursors()[ROOM] === '1');
  matrix.add(ROOM, message('$buffered'), message('$self', SELF));
  matrix.joined.add(PLANNING);
  matrix.add(PLANNING, message('$other-room'));
  stop.abort(new Error('cancel batching window'));
  assert.match(String(await result), /cancel batching window/);
  assert.deepEqual(cursors(), { [ROOM]: '1' });
  assert.equal(submissions(native).length, 1);
  const restarted = new AbortController();
  const restartedResult = listen(options, restarted.signal).catch((error: unknown) => error);
  context.after(async () => { restarted.abort(); await restartedResult; });
  const started = performance.now();
  await until(() => cursors()[ROOM] === '3' && cursors()[PLANNING] === '1');
  assert(performance.now() - started < 1000);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [['$received'], ['$buffered', '$other-room']]);
});

test('native connection failure during a window leaves pending events unread', async context => {
  const { native, matrix, result, cursors } = await fixture(context, { debounceMs: 1000 });
  matrix.add(ROOM, message('$received'));
  await until(() => cursors()[ROOM] === '1');
  matrix.add(ROOM, message('$not-received'));
  native.disconnect();
  assert(await result instanceof Error);
  assert.equal(cursors()[ROOM], '1');
  assert.equal(submissions(native).length, 1);
});

test('multi-window backlogs keep every event, room cursor, and bounded input', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 100, limit: 2 });
  matrix.joined.add(PLANNING);
  for (const room of [ROOM, PLANNING]) {
    matrix.add(room, ...Array.from({ length: 5 }, (_, index) => message(`${room}-${index}`, undefined, 'x'.repeat(50_000))));
  }
  await until(() => cursors()[ROOM] === '5' && cursors()[PLANNING] === '5');
  const inputs = content(native);
  assert.equal(inputs.length, 5);
  for (const room of [ROOM, PLANNING]) {
    assert.deepEqual(inputs.flat().filter(event => event.room_id === room).map(event => event.event_id),
      Array.from({ length: 5 }, (_, index) => `${room}-${index}`));
    assert(matrix.requests.filter(request => request.path === `${API}/rooms/${room}/messages`)
      .every(request => request.query.get('limit') === '2'));
  }
});

test('self echoes do not start a window and the first message after idle is immediate', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  matrix.add(ROOM, message('$self', SELF));
  await until(() => cursors()[ROOM] === '1');
  assert.equal(submissions(native).length, 0);
  let started = performance.now();
  matrix.add(ROOM, message('$human'));
  await until(() => cursors()[ROOM] === '2');
  assert(performance.now() - started < 700);
  await until(() => matrix.waiting() === 1);
  started = performance.now();
  matrix.add(ROOM, message('$after-idle'));
  await until(() => cursors()[ROOM] === '3');
  assert(performance.now() - started < 700);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$human'], ['$after-idle']]);
});

test('an explicit room selector excludes other rooms from both windows and checkpoints', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 200, room: 'coordination' });
  matrix.joined.add(PLANNING);
  matrix.add(ROOM, message('$selected-first'));
  matrix.add(PLANNING, message('$excluded'));
  await until(() => cursors()[ROOM] === '1');
  matrix.add(ROOM, message('$selected-second'));
  await until(() => cursors()[ROOM] === '2');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$selected-first'], ['$selected-second']]);
  assert.equal(cursors()[PLANNING], undefined);
  assert(!matrix.requests.some(request => request.path === `${API}/rooms/${PLANNING}/messages`));
});

test('buffering never bypasses observer, authorization, or oversized-event rejection', async context => {
  for (const kind of ['observer', 'authorization', 'oversized']) {
    await context.test(kind, async childContext => {
      const { native, matrix, result, cursors } = await fixture(childContext, { debounceMs: 200 });
      matrix.add(ROOM, message('$received'));
      await until(() => cursors()[ROOM] === '1');
      matrix.add(ROOM, message('$reject', undefined, kind === 'oversized' ? 'x'.repeat(128 * 1024) : kind));
      if (kind === 'observer') matrix.missingObserver.add(ROOM);
      if (kind === 'authorization') matrix.failures.set(API + '/sync', [401]);
      assert.match(String(await result), kind === 'observer' ? /observer/ : kind === 'authorization' ? /HTTP 401/ : /128 KiB/);
      assert.equal(cursors()[ROOM], '1');
      assert.equal(submissions(native).length, 1);
      assert(existsSync(matrix.cursorFile));
    });
  }
});
