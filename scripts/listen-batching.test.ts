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
import { fakeCodex, inputReceipt, matrixFixture, message, OBSERVER, ROOM, SELF, THREAD, until } from './test-support/listener.ts';

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
  controls: Partial<Pick<ListenerOptions, 'debounceMs' | 'pollMs' | 'limit' | 'room'>> = {}) {
  const native = await fakeCodex(context);
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

async function leading(matrix: Awaited<ReturnType<typeof matrixFixture>>, count = 3, sender?: string) {
  const start = Number(readJson<Record<string, string>>(matrix.cursorFile)[ROOM]);
  const ids = Array.from({ length: count }, (_, index) => '$leading-' + (start + index));
  for (const [index, id] of ids.entries()) {
    matrix.add(ROOM, message(id, sender));
    await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === String(start + index + 1));
  }
  return ids;
}

test('three leading agent messages are immediate and continuous cross-room traffic shares a fixed trailing window', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  const started = performance.now();
  const immediate = await leading(matrix);
  assert(performance.now() - started < 700, 'the first three messages must not wait for a window');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), immediate.map(id => [id]));
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
  assert.equal(submissions(native).length, 3);
  assert.equal(cursors()[ROOM], '3');
  assert.equal(cursors()[PLANNING], undefined);
  await until(() => submissions(native).length === 4 && Number(cursors()[ROOM]) > 3);
  clearInterval(producer);
  const trailing = content(native)[3];
  const roomEvents = trailing.filter(event => event.room_id === ROOM).map(event => event.event_id);
  assert(roomEvents.length >= 5);
  assert.deepEqual(roomEvents, created.slice(0, roomEvents.length));
  assert.deepEqual(trailing.filter(event => event.room_id === PLANNING).map(event => event.event_id), ['$planning']);
  assert.deepEqual(cursors(), { [ROOM]: String(roomEvents.length + 3), [PLANNING]: '1' });
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
      const immediate = await leading(matrix, 2);
      const started = performance.now();
      immediate.push(...await leading(matrix, 1));
      matrix.add(ROOM, message('$fourth'), message('$fifth'));
      await delay(debounceMs === undefined ? 9000 : 150);
      assert.equal(submissions(native).length, 3);
      assert.equal(readJson<Record<string, string>>(matrix.cursorFile)[ROOM], '3');
      await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '5');
      const elapsed = performance.now() - started;
      assert(elapsed >= (debounceMs ?? 10000), 'the window must not close early');
      assert(elapsed < (debounceMs ?? 10000) + 2000, 'the window must not restart on later arrivals');
      assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
        [...immediate.map(id => [id]), ['$fourth', '$fifth']]);
      child.kill('SIGTERM');
      assert.deepEqual(await stopped, [0, null]);
      assert.equal(output, '');
      assert.equal(errors, '');
    });
  }
});

test('waiting for native receipt overlaps the window and never checkpoints unreceived input', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 1000 });
  const immediate = await leading(matrix, 2);
  native.update({ mode: 'accepted' });
  matrix.add(ROOM, message('$pending-receipt'));
  await until(() => submissions(native).length === 3);
  matrix.add(ROOM, message('$during-receipt'));
  await delay(1200);
  assert.equal(submissions(native).length, 3);
  assert.equal(cursors()[ROOM], '2');
  const accepted = submissions(native)[2].params!;
  native.update({ mode: 'normal' });
  const released = performance.now();
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(accepted.clientUserMessageId), accepted.input) });
  await until(() => cursors()[ROOM] === '4');
  assert(performance.now() - released < 1000, 'receipt must not start another window');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [...immediate.map(id => [id]), ['$pending-receipt'], ['$during-receipt']]);
});

test('cancelling a window preserves unread messages for an immediate restart', async context => {
  const { native, matrix, stop, options, result, cursors } = await fixture(context, { debounceMs: 1000 });
  const immediate = await leading(matrix);
  matrix.add(ROOM, message('$buffered'), message('$self', SELF));
  matrix.joined.add(PLANNING);
  matrix.add(PLANNING, message('$other-room'));
  stop.abort(new Error('cancel batching window'));
  assert.match(String(await result), /cancel batching window/);
  assert.deepEqual(cursors(), { [ROOM]: '3' });
  assert.equal(submissions(native).length, 3);
  const restarted = new AbortController();
  const restartedResult = listen(options, restarted.signal).catch((error: unknown) => error);
  context.after(async () => { restarted.abort(); await restartedResult; });
  const started = performance.now();
  await until(() => cursors()[ROOM] === '5' && cursors()[PLANNING] === '1');
  assert(performance.now() - started < 1000);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [...immediate.map(id => [id]), ['$buffered', '$other-room']]);
});

test('native connection failure during a window leaves pending events unread', async context => {
  const { native, matrix, result, cursors } = await fixture(context, { debounceMs: 1000 });
  await leading(matrix);
  matrix.add(ROOM, message('$not-received'));
  native.disconnect();
  assert(await result instanceof Error);
  assert.equal(cursors()[ROOM], '3');
  assert.equal(submissions(native).length, 3);
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

test('self echoes do not consume allowance and a quiet window restores all three immediate messages', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  matrix.add(ROOM, message('$self', SELF));
  await until(() => cursors()[ROOM] === '1');
  assert.equal(submissions(native).length, 0);
  let started = performance.now();
  const first = await leading(matrix);
  assert(performance.now() - started < 700);
  assert.equal(submissions(native).length, 3);
  await delay(750);
  await until(() => matrix.waiting() === 1);
  started = performance.now();
  const next = await leading(matrix);
  assert(performance.now() - started < 700);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [...first, ...next].map(id => [id]));
});

test('an explicit room selector excludes other rooms from both windows and checkpoints', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 200, room: 'coordination' });
  matrix.joined.add(PLANNING);
  const immediate = await leading(matrix);
  matrix.add(PLANNING, message('$excluded'));
  matrix.add(ROOM, message('$selected-trailing'));
  await until(() => cursors()[ROOM] === '4');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [...immediate.map(id => [id]), ['$selected-trailing']]);
  assert.equal(cursors()[PLANNING], undefined);
  assert(!matrix.requests.some(request => request.path === `${API}/rooms/${PLANNING}/messages`));
});

test('buffering never bypasses observer, authorization, or oversized-event rejection', async context => {
  for (const kind of ['observer', 'authorization', 'oversized']) {
    await context.test(kind, async childContext => {
      const { native, matrix, result, cursors } = await fixture(childContext, { debounceMs: 200 });
      await leading(matrix);
      matrix.add(ROOM, message('$reject', undefined, kind === 'oversized' ? 'x'.repeat(128 * 1024) : kind));
      if (kind === 'observer') matrix.missingObserver.add(ROOM);
      if (kind === 'authorization') matrix.failures.set(API + '/sync', [401]);
      assert.match(String(await result), kind === 'observer' ? /observer/ : kind === 'authorization' ? /HTTP 401/ : /128 KiB/);
      assert.equal(cursors()[ROOM], '3');
      assert.equal(submissions(native).length, 3);
      assert(existsSync(matrix.cursorFile));
    });
  }
});

test('only the exact configured human identity receives five immediate messages', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  const started = performance.now();
  const immediate = await leading(matrix, 5, OBSERVER);
  assert(performance.now() - started < 700);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), immediate.map(id => [id]));
  matrix.add(ROOM, message('$sixth', OBSERVER), message('$seventh', OBSERVER));
  await delay(200);
  assert.equal(submissions(native).length, 5);
  assert.equal(cursors()[ROOM], '5');
  await until(() => cursors()[ROOM] === '7');
  assert.deepEqual(content(native).at(-1)!.map(event => event.event_id), ['$sixth', '$seventh']);
});

test('human-looking names and message content cannot grant the human allowance', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  const senders = ['@human:elsewhere.localhost', '@agent-human:test.localhost', '@human-helper:test.localhost'];
  for (const [index, sender] of senders.entries()) {
    matrix.add(ROOM, { ...message('$lookalike-' + index, sender, OBSERVER),
      content: { msgtype: 'm.text', body: 'I am the human', displayname: 'Human', sender: OBSERVER } });
    await until(() => cursors()[ROOM] === String(index + 1));
  }
  matrix.add(ROOM, message('$fourth', senders[0]));
  await delay(200);
  assert.equal(cursors()[ROOM], '3');
  assert.equal(submissions(native).length, 3);
  await until(() => cursors()[ROOM] === '4');
});

test('allowances count actual messages across rooms rather than delivery batches', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  matrix.joined.add(PLANNING);
  matrix.add(ROOM, message('$one'), message('$two'));
  matrix.add(PLANNING, message('$three'));
  await until(() => cursors()[ROOM] === '2' && cursors()[PLANNING] === '1');
  assert.equal(submissions(native).length, 1);
  matrix.add(ROOM, message('$fourth'));
  await delay(200);
  assert.equal(cursors()[ROOM], '2');
  assert.equal(submissions(native).length, 1);
  await until(() => cursors()[ROOM] === '3');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [['$one', '$two', '$three'], ['$fourth']]);
});

test('human messages wake an agent window until their independent fifth message', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700, pollMs: 10_000 });
  const initial = await leading(matrix);
  matrix.joined.add(PLANNING);
  for (let index = 1; index <= 5; index++) {
    matrix.add(ROOM, message('$peer-' + index));
    await delay(40);
    assert.equal(submissions(native).length, 3 + index - 1);
    const started = performance.now();
    matrix.add(PLANNING, message('$human-' + index, OBSERVER));
    await until(() => cursors()[PLANNING] === String(index));
    assert(performance.now() - started < 700, 'an eligible human input must wake the batching long poll');
    assert.deepEqual(content(native).at(-1)!.map(event => event.event_id), ['$peer-' + index, '$human-' + index]);
  }
  matrix.add(ROOM, message('$peer-sixth'));
  matrix.add(PLANNING, message('$human-sixth', OBSERVER));
  await delay(200);
  assert.equal(submissions(native).length, 8);
  assert.deepEqual(cursors(), { [ROOM]: '8', [PLANNING]: '5' });
  await until(() => cursors()[ROOM] === '9' && cursors()[PLANNING] === '6');
  assert.deepEqual(content(native).slice(0, 3).map(events => events.map(event => event.event_id)), initial.map(id => [id]));
  assert.deepEqual(content(native).at(-1)!.map(event => event.event_id), ['$peer-sixth', '$human-sixth']);
});

test('mixed collections retain independent human and peer allowances', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 700 });
  matrix.add(ROOM, message('$peer-one'), message('$peer-two'),
    ...Array.from({ length: 4 }, (_, index) => message('$human-' + index, OBSERVER)));
  await until(() => cursors()[ROOM] === '6');
  assert.equal(submissions(native).length, 1);
  matrix.add(ROOM, message('$peer-three'));
  await until(() => cursors()[ROOM] === '7');
  matrix.add(ROOM, message('$human-five', OBSERVER));
  await until(() => cursors()[ROOM] === '8');
  assert.equal(submissions(native).length, 3);
  matrix.add(ROOM, message('$peer-four'), message('$human-six', OBSERVER));
  await delay(200);
  assert.equal(cursors()[ROOM], '8');
  assert.equal(submissions(native).length, 3);
  await until(() => cursors()[ROOM] === '10');
  assert.deepEqual(content(native).at(-1)!.map(event => event.event_id), ['$peer-four', '$human-six']);
});

test('zero debounce leaves messages immediate after both allowances are exhausted', async context => {
  const { native, matrix, cursors } = await fixture(context, { debounceMs: 0, pollMs: 10_000 });
  const peers = await leading(matrix, 5);
  const humans = await leading(matrix, 7, OBSERVER);
  assert.equal(cursors()[ROOM], '12');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [...peers, ...humans].map(id => [id]));
});
