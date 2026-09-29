import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { matrixFixture, message, ROOM, OBSERVER, until } from '../test-support/listener.js';
import { nativeCodex } from '../test-support/native-codex.js';

test('owned native Codex receipts, interruption recovery, commands and Matrix integration', { timeout: 60_000 }, async context => {
  const native = await nativeCodex(context);
  assert(Array.isArray((await native.call('thread/timeline/list', { threadId: native.thread.id, limit: 1 })).data));
  assert.equal(native.requests.length, 0, 'Attaching must not submit model input');
  const adapter = native.adapter;
  context.after(adapter.close);
  await adapter.deliver('idle fixture input', 'fixture-idle');
  await until(() => native.held() !== undefined);
  assert.equal(((await native.call('thread/read', { threadId: native.thread.id, includeTurns: false })).thread as { status: { type: string } }).status.type, 'active');
  let received = false;
  const busy = adapter.deliver('busy fixture input', 'fixture-busy').then(() => { received = true; });
  await until(() => native.acknowledgements().length === 2);
  assert.equal(received, false);
  assert.equal(native.notifications.filter(event => event.method === 'turn/started').length, 1);
  native.finish();
  await busy;
  await until(() => native.completed() === 1);
  assert(native.requests.some(request => JSON.stringify(request).includes('idle fixture input')));
  assert(native.requests.some(request => JSON.stringify(request).includes('busy fixture input')));
  const users = () => native.notifications.filter(event => event.method === 'item/completed'
    && (event.params.item as { type: string }).type === 'userMessage');
  assert(users().some(event => (event.params.item as { clientId: string }).clientId === 'fixture-busy'));

  const beforeTool = native.completed();
  native.tool('exec_command', { cmd: 'printf fixture-output', max_output_tokens: 100, yield_time_ms: 1000 });
  await adapter.deliver('tool routing fixture', 'fixture-tool');
  await until(() => native.completed() > beforeTool);
  assert(native.notifications.some(event => event.method === 'item/completed' && (event.params.item as { type: string }).type === 'commandExecution'));
  assert(native.requests.some(request => JSON.stringify(request).includes('fixture-output')));

  native.hold();
  await adapter.deliver('interruptible original input', 'fixture-original');
  await until(() => native.held() !== undefined);
  const beforeInterrupted = native.acknowledgements().length;
  received = false;
  const interrupted = adapter.deliver('must survive interruption', 'fixture-interrupted').then(() => { received = true; });
  await until(() => native.acknowledgements().length > beforeInterrupted);
  assert.equal(received, false);
  const acceptedTurn = native.acknowledgements().at(-1)!.turn.id;
  await native.call('turn/interrupt', { threadId: native.thread.id, turnId: acceptedTurn });
  await interrupted;
  await until(() => native.completed() >= beforeTool + 3);
  const replay = native.acknowledgements().filter(value => value.params.clientUserMessageId === 'fixture-interrupted');
  assert.equal(replay.length, 2, JSON.stringify({ replay, history: native.historyQueries, users: users().map(event => event.params) }));
  assert.notEqual(replay[0]!.turn.id, replay[1]!.turn.id);
  assert.deepEqual(replay[0]!.params, replay[1]!.params);
  assert(native.relayRequests.some(request => request.method === 'thread/timeline/list'));
  assert.equal(users().filter(event => (event.params.item as { clientId: string }).clientId === 'fixture-interrupted').length, 1);
  assert(native.requests.some(request => JSON.stringify(request).includes('must survive interruption')));
  for (const clientId of ['fixture-idle', 'fixture-busy', 'fixture-tool', 'fixture-original']) {
    assert.equal(users().filter(event => (event.params.item as { clientId: string }).clientId === clientId).length, 1, clientId);
  }

  native.hold();
  const beforeReceivedInterrupt = native.completed();
  await adapter.deliver('already recorded before cancellation', 'fixture-recorded');
  await until(() => native.held() !== undefined);
  await native.call('turn/interrupt', { threadId: native.thread.id, turnId: native.acknowledgements().at(-1)!.turn.id });
  await until(() => native.completed() > beforeReceivedInterrupt);
  assert.equal(native.acknowledgements().filter(value => value.params.clientUserMessageId === 'fixture-recorded').length, 1);
  const matrix = await matrixFixture(context, native.workspace);
  const stop = new AbortController();
  const receiving = listen({ ...matrix, reconcileMs: 120_000, limit: 2, pollMs: 100, debounceMs: 100, runtime: native.runtime }, stop.signal)
    .catch(error => error);
  context.after(async () => { stop.abort(new Error('verification complete')); await receiving; });
  await until(() => matrix.waiting() === 1);
  native.hold();
  await native.call('turn/start', { threadId: native.thread.id, input: [{ type: 'text', text: 'hold during Matrix burst', text_elements: [] }] });
  await until(() => native.held() !== undefined);
  const beforeBurst = native.acknowledgements().length;
  matrix.add(ROOM, ...Array.from({ length: 6 }, (_, index) => message('$native-' + index, undefined, 'Matrix burst ' + index)));
  await until(() => native.acknowledgements().length > beforeBurst);
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
  await native.call('turn/interrupt', { threadId: native.thread.id, turnId: native.acknowledgements().at(-1)!.turn.id });
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '6');
  await until(() => native.requests.some(request => JSON.stringify(request).includes('Matrix burst 5')));
  for (let index = 0; index < 6; index++) {
    assert(native.requests.some(request => JSON.stringify(request).includes('Matrix burst ' + index)));
    assert.equal(users().filter(event => JSON.stringify(event).includes('$native-' + index)).length, 1);
  }
  stop.abort(new Error('verification complete'));
  assert.match(String(await receiving), /verification complete/);
  assert(!native.relayRequests.some(request => ['turn/interrupt', 'thread/start', 'thread/resume', 'thread/fork'].includes(request.method ?? '')));
  assert(native.notifications.every(event => !JSON.stringify(event).includes('api.openai.com')));
  console.log('PASS owned native receipts, busy delivery, interrupted input, actual command, cancellation and Matrix burst recovery.');
});

test('installed Codex verifies new input independently of previous turn history', { timeout: 60_000 }, async context => {
  const native = await nativeCodex(context);
  const threadId = native.thread.id;
  await native.call('turn/start', { threadId, input: [{ type: 'text', text: 'initial history', text_elements: [] }] });
  await until(() => native.held() !== undefined);
  native.finish();
  await until(() => native.completed() === 1);
  for (let index = 0; index < 30; index++) {
    await native.call('turn/start', { threadId, input: [{ type: 'text', text: 'historical input ' + index, text_elements: [] }] });
    await until(() => native.completed() === index + 2);
  }
  const old = await native.call('thread/timeline/list', { threadId, limit: 100 });
  assert.equal((old.data as unknown[]).length, 100);
  assert.equal(typeof old.nextCursor, 'string');
  const connection = native.adapter;
  context.after(connection.close);
  for (let index = 0; index < 60; index++) {
    const before = native.historyQueries.length;
    await connection.deliver('new input ' + index, 'native-history-' + index);
    await until(() => native.completed() === index + 32);
    const reads = native.historyQueries.slice(before);
    assert(reads.length >= 2 && reads.length <= 5, JSON.stringify(reads));
    assert(reads.every(read => !(read.params as { cursor?: string }).cursor));
    assert.equal(native.acknowledgements().filter(value => value.params.clientUserMessageId === 'native-history-' + index).length, 1);
    assert.equal(native.notifications.filter(event => event.method === 'item/completed'
      && (event.params.item as { clientId?: string }).clientId === 'native-history-' + index).length, 1);
  }
  assert(!native.relayRequests.some(request => ['turn/interrupt', 'thread/start', 'thread/resume', 'thread/fork'].includes(request.method ?? '')));
  console.log('PASS 60 native deliveries over paginated prior history with bounded, non-historical receipt queries.');
});

test('a human Matrix control cancels the owned native Codex run during receipt wait', { timeout: 60_000 }, async context => {
  const native = await nativeCodex(context);
  const matrix = await matrixFixture(context, native.workspace);
  const stop = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 120_000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  context.after(async () => { stop.abort(new Error('verification complete')); await result; });
  await until(() => existsSync(matrix.cursorFile) && matrix.waiting() === 1);
  await native.call('turn/start', { threadId: native.thread.id, input: [{ type: 'text', text: 'human-owned work', text_elements: [] }] });
  await until(() => native.held() !== undefined);
  matrix.add(ROOM, message('$pending-native'));
  await until(() => native.acknowledgements().length === 1);
  const captured = native.acknowledgements()[0]!.turn.id;
  matrix.add(ROOM, message('$stop-native', OBSERVER, '!!'));
  await until(() => {
    const state = JSON.parse(readFileSync(matrix.cursorFile + '.control', 'utf8'));
    return state.paused;
  });
  const interruptions = native.relayRequests.filter(request => request.method === 'turn/interrupt');
  assert.equal(interruptions.length, 1);
  assert.deepEqual(interruptions[0]!.params, { threadId: native.thread.id, turnId: captured });
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0');
  assert.equal(native.acknowledgements().length, 1);
  assert(native.notifications.some(event => event.method === 'turn/completed' && (event.params.turn as { id: string; status: string }).id === captured));
  matrix.add(ROOM, message('$redirect-native', OBSERVER, '!! Only do this new work.'));
  await until(() => native.requests.some(request => JSON.stringify(request).includes('Only do this new work.')));
  assert(!native.relayRequests.some(request => ['thread/resume', 'thread/start', 'thread/fork'].includes(request.method ?? '')));
  console.log('PASS noncontrolling exact-turn cancellation, paused unread input, and human redirect through the real Codex server.');
});
