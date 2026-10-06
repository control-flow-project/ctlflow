import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { testClock, withClock } from './test-support/clock.js';
import { localState as storage } from '@ctlflow/crossfire-adapter-filesystem/state';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { matrix as nativeMatrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { Event } from '@ctlflow/crossfire-contracts/client';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { connectCodex } from '@ctlflow/crossfire-adapter-codex/connection';
import { isControl, loadControl, type ControlState } from '@ctlflow/crossfire-agent-core/control';
import { eventView } from '@ctlflow/crossfire-agent-core/receive';
import { isListenerNotice, LISTENER_NOTICE } from '@ctlflow/crossfire-contracts/notices';
import { createHash } from 'node:crypto';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { fakeCodex, inputReceipt, matrixFixture, message, OBSERVER, ROOM, SELF, THREAD, temporary } from './test-support/listener.js';

async function fixture(context: TestContext, clock: ReturnType<typeof testClock>) {
  const native = await fakeCodex(context, { mode: 'accepted' });
  const matrix = await matrixFixture(context, native.directory, clock);
  const stop = new AbortController();
  const options = { ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime };
  let failure: unknown;
  const result = listen(options, stop.signal).catch(error => { failure = error; return error; });
  const unsubscribe = clock.subscribe(async () => { if (failure !== undefined && !stop.signal.aborted) throw failure; });
  cleanup(context, unsubscribe);
  cleanup(context, async () => { stop.abort(new Error('test complete')); await clock.complete(result); });
  await clock.until(() => existsSync(matrix.cursorFile) && matrix.waiting() === 1);
  const starts = () => native.requests().filter(request => request.method === 'turn/start');
  const controls = () => readJson<ControlState>(matrix.cursorFile + '.control');
  return { matrix, native, stop, result, options, starts, controls };
}

test('a human stop interrupts a pending receipt without replay, remains paused, and survives restart', withClock(async (context, clock) => {

  const value = await fixture(context, clock);
  const { native, matrix, starts, controls } = value;
  matrix.add(ROOM, message('$pending'));
  await clock.until(() => starts().length === 1);
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
  await clock.until(() => controls().paused);
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
  assert.equal(native.requests().find(request => request.method === 'turn/interrupt')?.params?.turnId, 'existing-turn');
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
  matrix.add(ROOM, message('$buffered'));
  await clock.advance(250);
  assert.equal(starts().length, 1);
  assert(!matrix.requests.some(request => request.path.endsWith('/read_markers')));
  value.stop.abort(new Error('restart'));
  await clock.complete(value.result);
  const restarted = new AbortController();
  const result = listen(value.options, restarted.signal).catch(error => error);
  cleanup(context, async () => { restarted.abort(); await clock.complete(result); });
  await clock.until(() => matrix.waiting() === 1);
  assert(controls().paused);
  assert.equal(starts().length, 1);
  native.update({ mode: 'normal' });
  matrix.add(ROOM, message('$resume', OBSERVER, 'Continue with the new instruction.'));
  await clock.until(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '4');
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
}));

test('a runtime without native interruption pauses delivery and reports the limitation without model input', withClock(async (context, clock) => {

  const native = await fakeCodex(context);
  const matrix = await matrixFixture(context, native.directory, clock);
  const stop = new AbortController();
  const runtime: RuntimeAdapter = async (signal, pollMs, hooks) => {
    const connection = await native.runtime(signal, pollMs, hooks);
    const { turnControl: _control, ...delivery } = connection;
    return delivery;
  };
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime }, stop.signal).catch(error => error);
  cleanup(context, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => matrix.waiting() === 1);
  const controls = () => readJson<ControlState>(matrix.cursorFile + '.control');
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
  await clock.until(() => controls().paused && matrix.requests.some(request => request.path.includes('/send/m.room.message/')));
  const notice = matrix.requests.find(request => request.path.includes('/send/m.room.message/'))!.body as { msgtype: string; body: string };
  assert.equal(notice.msgtype, 'm.notice');
  assert(isListenerNotice({ type: 'm.room.message', content: notice }));
  assert.match(notice.body, /cannot interrupt the current turn/);
  assert.equal(native.requests().filter(request => request.method === 'turn/start' || request.method === 'turn/interrupt').length, 0);
  matrix.add(ROOM, message('$buffered'));
  await clock.advance(200);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  matrix.add(ROOM, message('$resume', OBSERVER, 'Continue.'));
  await clock.until(() => existsSync(matrix.cursorFile) && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '4');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert(!JSON.stringify(native.requests().find(request => request.method === 'turn/start')?.params?.input).includes('$stop'));
}));

for (const kind of ['read-only', 'native-denial'] as const) {
  test('a runtime without turn control remains paused and connected after ' + kind + ' notice denial', withClock(async (context, clock) => {

    const native = await fakeCodex(context);
    const matrix = await matrixFixture(context, native.directory, clock);
    const stop = new AbortController();
    const runtime: RuntimeAdapter = async (signal, pollMs, hooks) => {
      const { turnControl: _control, ...delivery } = await native.runtime(signal, pollMs, hooks);
      return delivery;
    };
    if (kind === 'read-only') matrix.accessModes.set(ROOM, 'read');
    const transaction = 'crossfire-control-' + createHash('sha256').update('$stop').digest('hex');
    const noticePath = `${API}/rooms/${ROOM}/send/m.room.message/${transaction}`;
    if (kind === 'native-denial') matrix.failures.set(noticePath, [403]);
    let ended = false;
    const options = { ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime };
    const result = listen(options, stop.signal).catch(error => error).finally(() => { ended = true; });
    cleanup(context, async () => { stop.abort(); await clock.complete(result); });
    await clock.until(() => existsSync(matrix.cursorFile) && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === 'sync-0'
      && matrix.waiting() === 1, 'The initial unread boundary must be durable before live control input');
    const controls = () => readJson<ControlState>(matrix.cursorFile + '.control');
    matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
    await clock.until(() => controls().paused && readJson<string>(matrix.cursorFile + '.sync') === 'sync-1');
    if (kind === 'read-only') assert.equal(matrix.requests.filter(request => request.path === noticePath).length, 0);
    else assert.equal(matrix.requests.filter(request => request.path === noticePath).length, 1);
    matrix.add(ROOM, message('$buffered'));
    await clock.until(() => readJson<string>(matrix.cursorFile + '.sync') === 'sync-2');
    assert.equal(ended, false);
    assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
    assert(!matrix.requests.some(request => request.path.endsWith('/read_markers')));
    assert.equal(readJson<Record<string, string>>(matrix.cursorFile)[ROOM], 'sync-0');
    matrix.add(ROOM, message('$resume', OBSERVER, 'Continue.'));
    await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '3');
    const starts = native.requests().filter(request => request.method === 'turn/start');
    assert.equal(starts.length, 1);
    assert(JSON.stringify(starts[0]!.params!.input).includes('$buffered'));
    assert(JSON.stringify(starts[0]!.params!.input).includes('$resume'));
    assert(!JSON.stringify(starts[0]!.params!.input).includes('$stop'));
    assert.equal(ended, false);
  }));
}

test('automatic peer notices neither wake the model nor contaminate subsequent authorized context', withClock(async (context, clock) => {

  const { matrix, native, starts } = await fixture(context, clock);
  matrix.waking.policy = 'owner'; matrix.waking.senders = [OBSERVER];
  matrix.add(ROOM, message('$pending-context', '@other:test.localhost', 'Keep this context.'));
  const automatic = { ...message('$peer-notice'), content: { msgtype: 'm.notice', [LISTENER_NOTICE]: true,
    body: 'Listener delivery is paused. This runtime connection cannot interrupt the current turn; stop it in the coding session.' } };
  assert(isListenerNotice(automatic));
  matrix.add(ROOM, automatic);
  await clock.advance(200);
  assert.equal(starts().length, 0);
  matrix.waking.policy = 'owner-agents'; matrix.waking.senders = [OBSERVER, automatic.sender];
  matrix.wake();
  await clock.until(() => matrix.requests.filter(request => request.path.endsWith('/delivery-policy')).length >= 3);
  await clock.advance(150);
  assert.equal(starts().length, 0, 'An allowed peer automatic notice is not a wake authority');
  const legitimate = { ...message('$legitimate-notice', '@other:test.localhost'), content: { msgtype: 'm.notice', body: 'A real status update.' } };
  assert.equal(isListenerNotice(legitimate), false);
  native.update({ mode: 'normal' });
  matrix.add(ROOM, legitimate, message('$owner-wake', OBSERVER, 'Please continue.'));
  await clock.until(() => starts().length === 1);
  const input = JSON.stringify(starts()[0]!.params!.input);
  assert(input.includes('$pending-context'));
  assert(input.includes('$legitimate-notice'));
  assert(input.includes('$owner-wake'));
  assert(!input.includes('$peer-notice'));
}));

test('urgent redirect precedes unread ordinary input and cannot advance its contiguous read marker', withClock(async (context, clock) => {

  const { native, matrix, starts } = await fixture(context, clock);
  matrix.add(ROOM, message('$ordinary'));
  await clock.until(() => starts().length === 1);
  matrix.add(ROOM, message('$redirect', OBSERVER, '!! Inspect configuration instead.'));
  await clock.until(() => starts().length === 2);
  const urgent = starts()[1]!.params!;
  assert(JSON.stringify(urgent.input).includes('$redirect'));
  assert(!JSON.stringify(urgent.input).includes('$ordinary'));
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(urgent.clientUserMessageId), urgent.input) });
  await clock.until(() => starts().length === 3);
  assert(JSON.stringify(starts()[2]!.params!.input).includes('$ordinary'));
  assert(!JSON.stringify(starts()[2]!.params!.input).includes('$redirect'));
  assert(!matrix.requests.some(request => request.path.endsWith('/read_markers')));
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
}));

test('a receipt published during human interruption is acknowledged without replaying the original input', withClock(async (context, clock) => {

  const { native, matrix, starts } = await fixture(context, clock);
  native.update({ delayInterrupt: true });
  matrix.add(ROOM, message('$ordinary'));
  await clock.until(() => starts().length === 1);
  const original = starts()[0]!.params!;
  matrix.add(ROOM, message('$redirect', OBSERVER, '!! Inspect configuration instead.'));
  await clock.until(() => native.requests().some(request => request.method === 'turn/interrupt'));
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(original.clientUserMessageId), original.input) });
  native.update({ mode: 'normal' });
  native.notify('turn/completed', { threadId: THREAD, turn: { id: 'existing-turn', status: 'interrupted', error: null } });
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '2');
  assert.equal(starts().length, 2);
  assert(JSON.stringify(starts()[1]!.params!.input).includes('$redirect'));
  assert(!JSON.stringify(starts()[1]!.params!.input).includes('$ordinary'));
}));

test('human control authority uses exact identity and shared-room native mentions, never display names', async context => {
  const matrix = await matrixFixture(context, temporary(context));
  const client = nativeMatrix({base: matrix.settings.homeserver, token: matrix.account.access_token});
  const check = (event: Event) => isControl(client, matrix.settings, matrix.account, eventView(event, ROOM));
  assert(await check(message('$human', OBSERVER, '!! stop')));
  for (const sender of [SELF, '@human:elsewhere', '@agent-human:test.localhost']) assert.equal(await check(message('$spoof', sender, '!! stop')), false);
  for (const body of ['!!nospace', '> !! stop', '```\n!! stop\n```', 'example !! stop']) assert.equal(await check(message('$example', OBSERVER, body)), false);
  const nonControlContent: Event['content'][] = [{ msgtype: 'm.notice', body: '!!' },
    { msgtype: 'm.text', body: '!!', 'm.relates_to': { rel_type: 'm.replace', event_id: '$old' } },
    { msgtype: 'm.text', body: '!!', 'm.new_content': { body: '!!' } }];
  for (const content of nonControlContent) {
    assert.equal(await check({ ...message('$not-original', OBSERVER), content }), false);
  }
  matrix.extraMembers.add('@agent-peer:test.localhost');
  assert.equal(await check(message('$shared', OBSERVER, '!! stop')), false);
  assert(await check({ ...message('$targeted', OBSERVER, '!! stop'), content: { msgtype: 'm.text', body: '!! stop', 'm.mentions': { user_ids: [SELF] } } }));
});

test('limited sync recovers an earlier control instead of losing it behind peer traffic', withClock(async (context, clock) => {

  const { matrix, starts, controls } = await fixture(context, clock);
  matrix.add(ROOM, message('$pending'));
  await clock.until(() => starts().length === 1);
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'), ...Array.from({ length: 25 }, (_, index) => message('$peer-' + index)));
  await clock.until(() => controls().paused);
  assert.equal(starts().length, 1);
  assert(matrix.requests.some(request => request.path.endsWith('/messages') && request.query.has('filter')));
}));

test('limited history recovery retains a control at the native sync upper boundary', withClock(async (context, clock) => {

  const { matrix, starts, controls } = await fixture(context, clock);
  matrix.add(ROOM, message('$pending'));
  await clock.until(() => starts().length === 1);
  matrix.overridePage({ chunk: [] });
  matrix.add(ROOM, ...Array.from({ length: 25 }, (_, index) => message('$peer-' + index)), message('$stop-at-boundary', OBSERVER, '!!'));
  await clock.until(() => controls().paused);
  assert.equal(starts().length, 1);
  assert(controls().controls.some(control => control.event === '$stop-at-boundary'));
}));

test('leaving during a human pause discards the old cursor without resuming delivery', withClock(async (context, clock) => {

  const { matrix, starts, controls } = await fixture(context, clock);
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
  await clock.until(() => controls().paused);
  const client = nativeMatrix({base: matrix.settings.homeserver, token: matrix.account.access_token});
  await client.post('/_matrix/client/v3/rooms/' + encodeURIComponent(ROOM) + '/leave', {});
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === undefined);
  assert(controls().paused);
  assert.equal(starts().length, 0);
  matrix.add(ROOM, ...Array.from({ length: 30 }, (_, index) => message('$away-' + index)));
  await client.post('/_matrix/client/v3/join/' + encodeURIComponent(ROOM), {});
  await clock.until(() => matrix.waiting() === 1);
  assert(controls().paused);
  assert.equal(starts().length, 0);
}));

test('leaving one room while a mixed-room delivery settles does not replay the other room', withClock(async (context, clock) => {

  const { matrix, native, starts } = await fixture(context, clock);
  const other = '!other:test.localhost';
  matrix.subscribe(other);
  matrix.add(ROOM, message('$leaving'), message('$also-leaving'));
  matrix.add(other, message('$retained'));
  await clock.until(() => starts().length === 1);
  assert(JSON.stringify(starts()[0]!.params!.input).includes('$retained'));
  const original = starts()[0]!.params!;
  const client = nativeMatrix({base: matrix.settings.homeserver, token: matrix.account.access_token});
  await client.post('/_matrix/client/v3/rooms/' + encodeURIComponent(ROOM) + '/leave', {});
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === undefined);
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(original.clientUserMessageId), original.input) });
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[other] === '1');
  assert.equal(starts().length, 1);
  assert.equal(readJson<Record<string, string>>(matrix.cursorFile)[ROOM], undefined);
}));

test('historical initial snapshots and edited or quoted messages have no cancellation authority', withClock(async (context, clock) => {

  const native = await fakeCodex(context);
  const matrix = await matrixFixture(context, native.directory, clock);
  matrix.add(ROOM, message('$old', OBSERVER, '!!'));
  const stop = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(context, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => existsSync(matrix.cursorFile));
  matrix.add(ROOM, { ...message('$edit', OBSERVER, '!!'), content: { msgtype: 'm.text', body: '!!', 'm.relates_to': { rel_type: 'm.replace', event_id: '$old' } } }, message('$quote', OBSERVER, '> !!'));
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '3');
  assert(!native.requests().some(request => request.method === 'turn/interrupt'));
  assert.equal(loadControl(storage, matrix.cursorFile + '.control', THREAD).paused, false);
}));

test('native cancellation confirms the captured turn only and never retargets a later turn', async context => {
  const native = await fakeCodex(context);
  const connection = await connectCodex(native.options, new AbortController().signal);
  cleanup(context, connection.close);
  assert.equal(await connection.turnControl.activeTurn(), null);
  await connection.deliver('first', 'first');
  const first = await connection.turnControl.activeTurn(); assert(first);
  await connection.turnControl.interrupt(first);
  await connection.deliver('second', 'second');
  const second = await connection.turnControl.activeTurn(); assert(second); assert.notEqual(second, first);
  await connection.turnControl.interrupt(first);
  assert.equal(await connection.turnControl.activeTurn(), second);
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
  await assert.rejects(connection.turnControl.interrupt(second, true), /uncertain/);
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
});

test('an interruption acknowledgement without terminal proof cannot admit replacement input', async context => {
  const native = await fakeCodex(context, { delayInterrupt: true });
  const connection = await connectCodex({ ...native.options, timeoutMs: 200 }, new AbortController().signal);
  cleanup(context, connection.close);
  await connection.deliver('original', 'original');
  await assert.rejects(connection.turnControl.interrupt((await connection.turnControl.activeTurn())!), /uncertain/);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});
