import { cleanup } from '@crossfire/test-support/cleanup';
import { testClock, withClock } from './test-support/clock.js';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { API } from '@crossfire/contracts/matrix';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import { listen, type ListenerOptions } from '@crossfire/adapter-crossfire/listener';
import type { ReceivedEvent } from '@crossfire/agent-core/receive';
import type { WakePolicy } from '@crossfire/contracts/wake';
import { builtClient } from './test-support/release.js';
import { fakeCodex, inputReceipt, matrixFixture, message, OBSERVER, ROOM, SELF, THREAD, until } from './test-support/listener.js';
import { listenerOptions } from '../apps/client/src/listener-options.js';

const PLANNING = '!planning:test.localhost';
const PEER = '@agent-holmes:test.localhost';
const HUMAN = '@other:test.localhost';
const OTHER_AGENT = '@agent-other:test.localhost';

function submissions(native: Awaited<ReturnType<typeof fakeCodex>>) {
  return native.requests().filter(request => request.method === 'turn/start');
}

function content(native: Awaited<ReturnType<typeof fakeCodex>>) {
  return submissions(native).map(request => {
    const input = request.params!.input as { text: string }[];
    assert.equal(input.length, 1);
    const text = input[0]!.text;
    assert(Buffer.byteLength(text) <= 100000);
    return (JSON.parse(text.slice(text.indexOf('\n') + 1)) as { events: ReceivedEvent[] }).events;
  });
}

async function fixture(context: TestContext, clock: ReturnType<typeof testClock>,
  controls: Partial<Pick<ListenerOptions, 'debounceMs' | 'pollMs' | 'limit' | 'room' | 'maximumBytes'>> = {}, initialAuthority: 'owner' | 'nobody' = 'owner',
  prepare?: (matrix: Awaited<ReturnType<typeof matrixFixture>>) => void) {
  const native = await fakeCodex(context);
  const matrix = await matrixFixture(context, native.directory, clock);
  matrix.waking.policy = initialAuthority; matrix.waking.senders = initialAuthority === 'nobody' ? [] : [OBSERVER];
  prepare?.(matrix);
  const stop = new AbortController();
  const options: ListenerOptions = { ...matrix, reconcileMs: 1000, limit: 2, pollMs: 100, debounceMs: 120,
    ...controls, runtime: native.runtime };
  let failure: unknown;
  const result = listen(options, stop.signal).catch((error: unknown) => { failure = error; return error; });
  const unsubscribe = clock.subscribe(async () => { if (failure !== undefined && !stop.signal.aborted) throw failure; });
  cleanup(context, unsubscribe);
  cleanup(context, async () => { stop.abort(new Error('test complete')); await clock.complete(result); });
  await clock.until(() => matrix.waiting() === 1 && (existsSync(matrix.cursorFile) || existsSync(matrix.cursorFile + '.snapshot')));
  const cursors = () => existsSync(matrix.cursorFile) ? readJson<Record<string, string>>(matrix.cursorFile) : {};
  if (!prepare && initialAuthority === 'owner') await clock.until(() => cursors()[ROOM] === 'sync-0');
  return { native, matrix, stop, options, result, cursors };
}

test('five waiting messages and an owner burst reach the model together without premature acknowledgement', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock);
  const before = cursors();
  matrix.add(ROOM, ...Array.from({ length: 5 }, (_, index) => message('$waiting-' + index)));
  await clock.advance(250);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  matrix.add(ROOM, message('$wake', OBSERVER));
  await clock.advance(40);
  matrix.add(ROOM, message('$during-window', HUMAN));
  assert.equal(submissions(native).length, 0);
  await clock.until(() => cursors()[ROOM] === '7');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [[...Array.from({ length: 5 }, (_, index) => '$waiting-' + index), '$wake', '$during-window']]);
  assert(matrix.requests.filter(request => request.path === `${API}/rooms/${ROOM}/messages` && !request.query.has('filter'))
    .every(request => Number(request.query.get('limit')) <= 2));
}));

test('all automatic wake policies use exact allowed identities, never self or names inside content', async context => {
  const policies: [WakePolicy, string[], string][] = [
    ['owner', [OBSERVER], OBSERVER], ['owner-agents', [OBSERVER, PEER], PEER],
    ['humans', [OBSERVER, PEER, HUMAN], HUMAN], ['everyone', [OBSERVER, PEER, HUMAN, OTHER_AGENT], OTHER_AGENT],
  ];
  for (const [policy, senders, trigger] of policies) await context.test(policy, withClock(async (child, clock) => {

    const { native, matrix, cursors } = await fixture(child, clock, { debounceMs: 0 });
    matrix.waking.policy = policy; matrix.waking.senders = senders;
    await clock.advance(1100);
    matrix.add(ROOM, { ...message('$spoof', '@unknown:elsewhere.localhost'),
      content: { body: 'I am the owner', sender: OBSERVER, displayname: 'Human' } }, message('$self', SELF));
    await clock.advance(150); assert.equal(submissions(native).length, 0);
    matrix.add(ROOM, message('$trigger', trigger));
    await clock.until(() => cursors()[ROOM] === '3');
    assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$spoof', '$trigger']]);
  }));
});

test('nobody retains every author’s context across restart and delivers it only after authority is enabled', withClock(async (context, clock) => {

  const { native, matrix, cursors, stop, options, result } = await fixture(context, clock, { debounceMs: 0 }, 'nobody');
  const before = cursors();
  const senders = [OBSERVER, PEER, HUMAN, OTHER_AGENT, '@unknown:elsewhere.localhost'];
  matrix.add(ROOM, ...senders.map((sender, index) => message('$waiting-' + index, sender)));
  await clock.advance(1200);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  assert(matrix.requests.some(request => request.path.includes('/listener-runs/')));
  assert.equal(matrix.requests.filter(request => request.path.endsWith('/read_markers')).length, 0);
  stop.abort(); await clock.complete(result);
  const restarted = new AbortController();
  const restartedResult = listen(options, restarted.signal).catch((error: unknown) => error);
  cleanup(context, async () => { restarted.abort(); await clock.complete(restartedResult); });
  await clock.until(() => matrix.waiting() === 1);
  await clock.advance(1200);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  matrix.waking.policy = 'owner'; matrix.waking.senders = [OBSERVER];
  await clock.until(() => cursors()[ROOM] === '5');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [senders.map((_, index) => '$waiting-' + index)]);
}));

test('nobody blocks urgent owner prompts without disabling owner stop or starting a second receiver', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0 }, 'nobody');
  const before = cursors();
  matrix.add(ROOM, message('$urgent', OBSERVER, '!! do this now'));
  const controls = () => readJson<{ paused: boolean; controls: { event: string; status: string }[] }>(matrix.cursorFile + '.control');
  await clock.until(() => controls().controls.some(control => control.event === '$urgent' && control.status === 'interrupted'));
  await clock.advance(300);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
  await clock.until(() => controls().paused);
  matrix.add(ROOM, message('$resume', OBSERVER, 'continue'));
  await clock.until(() => !controls().paused);
  await clock.advance(300);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  await clock.until(() => matrix.waiting() === 1);
  assert.equal(matrix.maximumWaiting(), 1, 'The full pause/resume flow has only one acquisition receiver');
}));

test('selecting nobody during collection cancels an owner wake and preserves the unread trail', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 1500 });
  const before = cursors();
  matrix.add(ROOM, message('$peer'), message('$owner', OBSERVER));
  await clock.advance(150);
  matrix.waking.policy = 'nobody'; matrix.waking.senders = [];
  await clock.advance(1700);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  matrix.waking.policy = 'owner'; matrix.waking.senders = [OBSERVER];
  await clock.until(() => cursors()[ROOM] === '2');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$peer', '$owner']]);
}));

test('a wake beyond 125 pending messages releases one input even with two-event native pages and missed notifications', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0 });
  matrix.syncUpdates.enabled = false;
  matrix.add(ROOM, ...Array.from({ length: 125 }, (_, index) => message('$backlog-' + index)), message('$wake', OBSERVER));
  await clock.until(() => cursors()[ROOM] === '126');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [[...Array.from({ length: 125 }, (_, index) => '$backlog-' + index), '$wake']]);
}));

test('continuous traffic does not extend the fixed collection window or wake a second turn', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 300 });
  const started = clock.now();
  matrix.add(ROOM, message('$wake', OBSERVER));
  let produced = 0;
  const stopProducer = clock.schedule(() => matrix.add(ROOM, message('$burst-' + produced++)), 30, true);
  cleanup(context, stopProducer);
  await clock.advance(100); assert.equal(submissions(native).length, 0);
  await clock.until(() => submissions(native).length === 1 && Number(cursors()[ROOM]) > 1);
  stopProducer();
  assert(clock.now() - started >= 300);
  assert(clock.now() - started < 900);
  assert(content(native)[0]!.length >= 5);
  matrix.add(ROOM, message('$later'));
  await clock.advance(350); assert.equal(submissions(native).length, 1);
  matrix.add(ROOM, message('$next-wake', OBSERVER));
  await clock.until(() => Number(cursors()[ROOM]) === produced + 3);
  assert.equal(submissions(native).length, 2);
  assert(content(native)[1]!.some(event => event.event_id === '$later'));
}));

test('pending context is chronological across rooms while explicit selection excludes other rooms', async context => {
  for (const room of [undefined, ROOM]) await context.test(room ?? 'all rooms', withClock(async (child, clock) => {

    const { native, matrix, cursors } = await fixture(child, clock, { ...(room ? { room } : {}), debounceMs: 100 }, 'owner', matrix => {
      matrix.subscribe(PLANNING);
      writeJson(matrix.cursorFile, { [ROOM]: '0', [PLANNING]: '0' });
    });
    matrix.add(ROOM, { ...message('$later'), origin_server_ts: 200 });
    matrix.add(PLANNING, { ...message('$earlier'), origin_server_ts: 100 });
    matrix.add(ROOM, { ...message('$wake', OBSERVER), origin_server_ts: 300 });
    await clock.until(() => cursors()[ROOM] === '2');
    assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
      [room ? ['$later', '$wake'] : ['$earlier', '$later', '$wake']]);
    assert.equal(cursors()[PLANNING], room ? '0' : '1');
  }));
});

test('an initial recent snapshot stays pinned while waiting and across listener restart', withClock(async (context, clock) => {

  const native = await fakeCodex(context), matrix = await matrixFixture(context, native.directory, clock);
  matrix.waking.policy = 'owner'; matrix.waking.senders = [OBSERVER];
  matrix.add(ROOM, ...Array.from({ length: 5 }, (_, index) => message('$initial-' + index)));
  const options: ListenerOptions = { ...matrix, reconcileMs: 1000, limit: 5, pollMs: 100, debounceMs: 0, runtime: native.runtime };
  const first = new AbortController();
  const firstResult = listen(options, first.signal).catch((error: unknown) => error);
  cleanup(context, async () => { first.abort(); await clock.complete(firstResult); });
  await clock.until(() => existsSync(matrix.cursorFile + '.snapshot'));
  assert.equal(submissions(native).length, 0);
  first.abort(); await clock.complete(firstResult);
  matrix.add(ROOM, ...Array.from({ length: 6 }, (_, index) => message('$new-' + index)), message('$wake', OBSERVER));
  const second = new AbortController();
  const secondResult = listen(options, second.signal).catch((error: unknown) => error);
  cleanup(context, async () => { second.abort(); await clock.complete(secondResult); });
  await clock.until(() => existsSync(matrix.cursorFile) && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '12');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)),
    [[...Array.from({ length: 5 }, (_, index) => '$initial-' + index), ...Array.from({ length: 6 }, (_, index) => '$new-' + index), '$wake']]);
}));

test('membership reset retires an initial snapshot and resumes delivery from the current membership', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0, limit: 2 }, 'owner', matrix => {
    matrix.add(ROOM, message('$old-context'));
  });
  assert(existsSync(matrix.cursorFile + '.snapshot'));
  matrix.add(ROOM, { ...message('$rejoin', SELF), type: 'm.room.member', state_key: SELF,
    content: { membership: 'join' }, unsigned: { prev_content: { membership: 'invite' } } });
  await clock.until(() => existsSync(matrix.cursorFile + '.snapshot') && readJson<{ batch: { events: ReceivedEvent[] } }>(matrix.cursorFile + '.snapshot')
    .batch.events.some(event => event.event_id === '$rejoin'));
  matrix.add(ROOM, message('$current-owner', OBSERVER));
  await clock.until(() => cursors()[ROOM] === '3');
  assert.equal(submissions(native).length, 1);
  assert(content(native)[0]!.some(event => event.event_id === '$current-owner'));
}));

test('a newly granted room can wake the listener without replacing another room’s pinned context', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0, limit: 2 }, 'owner', matrix => {
    matrix.add(ROOM, message('$pinned-first'), message('$pinned-second'));
  });
  assert(existsSync(matrix.cursorFile + '.snapshot'));
  matrix.add(ROOM, message('$later-first'), message('$later-second'));
  matrix.joined.add(PLANNING);
  matrix.add(PLANNING, message('$new-context'), message('$new-owner', OBSERVER));
  await clock.until(() => cursors()[PLANNING] === '2' && cursors()[ROOM] === '4');
  assert.equal(submissions(native).length, 1);
  assert.deepEqual(content(native)[0]!.map(event => event.event_id).sort(),
    ['$pinned-first', '$pinned-second', '$later-first', '$later-second', '$new-context', '$new-owner'].sort());
}));

test('self echoes and owner room-state changes cannot wake but notices join the next authorized input', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0 });
  matrix.add(ROOM, message('$self', SELF));
  await clock.until(() => cursors()[ROOM] === '1');
  matrix.add(ROOM, { ...message('$rename', OBSERVER), type: 'm.room.name', state_key: '', content: { name: 'Renamed' } });
  await clock.advance(150); assert.equal(submissions(native).length, 0); assert.equal(cursors()[ROOM], '1');
  matrix.add(ROOM, message('$wake', OBSERVER));
  await clock.until(() => cursors()[ROOM] === '3');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$rename', '$wake']]);
}));

test('bulk delivery advances only after its exact receipt and later unauthorized traffic stays pending', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 0 });
  native.update({ mode: 'accepted' });
  const before = cursors();
  matrix.add(ROOM, message('$context'), message('$wake', OBSERVER));
  await clock.until(() => submissions(native).length === 1);
  await clock.advance(150); assert.deepEqual(cursors(), before);
  const accepted = submissions(native)[0]!.params!;
  native.update({ mode: 'normal' });
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(accepted.clientUserMessageId), accepted.input) });
  await clock.until(() => cursors()[ROOM] === '2');
  matrix.add(ROOM, message('$later'));
  await clock.advance(200); assert.equal(submissions(native).length, 1); assert.equal(cursors()[ROOM], '2');
}));

test('only the byte ceiling splits large context and remaining chunks do not require more wake messages or windows', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 100, maximumBytes: 64 * 1024 });
  matrix.add(ROOM, ...Array.from({ length: 5 }, (_, index) => message('$large-' + index, PEER, 'x'.repeat(45_000))), message('$wake', OBSERVER));
  const started = clock.now();
  await clock.until(() => cursors()[ROOM] === '6');
  assert(clock.now() - started < 1500);
  assert.equal(content(native).length, 5);
  assert.deepEqual(content(native).flat().map(event => event.event_id),
    [...Array.from({ length: 5 }, (_, index) => '$large-' + index), '$wake']);
}));

test('restricting authority during collection cancels the peer wake without losing its context', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 1500 });
  matrix.waking.policy = 'owner-agents'; matrix.waking.senders = [OBSERVER, PEER];
  await clock.advance(1100);
  const before = cursors();
  matrix.add(ROOM, message('$peer'));
  await clock.advance(150);
  matrix.waking.policy = 'owner'; matrix.waking.senders = [OBSERVER];
  await clock.advance(1600); assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  matrix.add(ROOM, message('$owner', OBSERVER));
  await clock.until(() => cursors()[ROOM] === '2');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$peer', '$owner']]);
}));

test('a saved wake drains remaining byte-sized context after restart without replaying its already received owner message', withClock(async (context, clock) => {

  const { native, matrix, cursors, stop, options, result } = await fixture(context, clock, { debounceMs: 0, maximumBytes: 64 * 1024 });
  const barrier = matrix.hold(`${API}/rooms/${ROOM}/read_markers`);
  matrix.add(ROOM, message('$owner', OBSERVER, 'o'.repeat(40_000)), message('$peer', PEER, 'p'.repeat(40_000)));
  await clock.until(() => barrier.entered() && cursors()[ROOM] === '1');
  assert.equal(submissions(native).length, 1);
  stop.abort(); barrier.release(); await clock.complete(result);
  const restarted = new AbortController();
  const restartedResult = listen(options, restarted.signal).catch((error: unknown) => error);
  cleanup(context, async () => { restarted.abort(); await clock.complete(restartedResult); });
  await clock.until(() => cursors()[ROOM] === '2');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$owner'], ['$peer']]);
}));

test('owner stop interrupts the collection window without sending its buffered messages', withClock(async (context, clock) => {

  const { native, matrix, cursors } = await fixture(context, clock, { debounceMs: 1500 });
  const before = cursors();
  matrix.add(ROOM, message('$peer'), message('$owner', OBSERVER));
  await clock.advance(100);
  matrix.add(ROOM, message('$stop', OBSERVER, '!!'));
  await clock.until(() => readJson<{ paused: boolean }>(matrix.cursorFile + '.control').paused);
  await clock.advance(1600);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
}));

test('stopping during a window keeps the complete unread context for reconnection', withClock(async (context, clock) => {

  const { native, matrix, stop, options, result, cursors } = await fixture(context, clock, { debounceMs: 500 });
  const before = cursors();
  matrix.add(ROOM, message('$peer'), message('$owner', OBSERVER));
  await clock.advance(100); stop.abort(new Error('stop collection')); await clock.complete(result);
  assert.equal(submissions(native).length, 0); assert.deepEqual(cursors(), before);
  const restarted = new AbortController();
  const restartedResult = listen(options, restarted.signal).catch((error: unknown) => error);
  cleanup(context, async () => { restarted.abort(); await clock.complete(restartedResult); });
  await clock.until(() => cursors()[ROOM] === '2');
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$peer', '$owner']]);
}));

test('validated CLI options select one ten-second collection window or an explicitly shorter window', async context => {
  for (const debounceMs of [undefined, 100]) await context.test(debounceMs === undefined ? 'default 10000ms' : 'configured 100ms', withClock(async (childContext, clock) => {
    const settings = listenerOptions(debounceMs === undefined ? {} : { 'debounce-ms': String(debounceMs) });
    assert.equal(settings.debounceMs, debounceMs ?? 10000);
    assert.equal(settings.pollMs, 10000); assert.equal(settings.reconcileMs, 120000);
    const { native, matrix, cursors } = await fixture(childContext, clock, settings);
    const started = clock.now();
    matrix.add(ROOM, message('$owner', OBSERVER), message('$peer-one'), message('$peer-two'));
    await clock.advance(debounceMs === undefined ? 9000 : 40);
    assert.equal(submissions(native).length, 0);
    await clock.advance(debounceMs ?? 10000);
    await clock.until(() => cursors()[ROOM] === '3');
    assert(clock.now() - started >= (debounceMs ?? 10000));
    assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$owner', '$peer-one', '$peer-two']]);
  }));
});

test('the installed CLI passes its collection settings to a live native listener', async context => {
  const native = await fakeCodex(context), matrix = await matrixFixture(context, native.directory);
  const child = spawn(process.execPath, [builtClient(), '--project', matrix.workspace, '--profile', 'watson', 'agent', 'listen', '--runtime', 'codex', '--poll-ms', '100', '--debounce-ms', '100'],
    { env: { ...matrix.env, FIXTURE_CODEX_TOKEN: 'fixture-only' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stopped = once(child, 'close'); let output = '', errors = '';
  assert(child.stdout && child.stderr);
  child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { errors += String(chunk); });
  cleanup(context, async () => { child.kill('SIGTERM'); await stopped; });
  await until(() => { assert.equal(child.exitCode, null, errors); return matrix.waiting() === 1 && existsSync(matrix.cursorFile); });
  const started = performance.now();
  matrix.add(ROOM, message('$owner', OBSERVER), message('$peer-one'), message('$peer-two'));
  await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '3');
  assert(performance.now() - started >= 100);
  assert.deepEqual(content(native).map(events => events.map(event => event.event_id)), [['$owner', '$peer-one', '$peer-two']]);
  child.kill('SIGTERM'); assert.deepEqual(await stopped, [0, null]);
  assert.deepEqual(JSON.parse(output), { runtime: 'codex', session: THREAD, workspace: matrix.workspace }); assert.equal(errors, '');
});
