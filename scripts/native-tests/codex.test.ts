import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { connectCodex } from '../../skills/conduit-chat/scripts/codex.ts';
import { listen } from '../../skills/conduit-chat/scripts/listen.ts';
import { matrixFixture, message, ROOM, until } from '../test-support/listener.ts';
import { nativeCodex } from '../test-support/native-codex.ts';

test('installed Codex receipts, interruption recovery, original controller, and Matrix integration', { timeout: 60_000 }, async context => {
  const native = await nativeCodex(context);
  const adapter = await connectCodex(native.options, new AbortController().signal);
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
  native.tool();
  await adapter.deliver('tool routing fixture', 'fixture-tool');
  await until(() => native.toolCalls() === 1 && native.completed() > beforeTool);
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
  assert.notEqual(replay[0].turn.id, replay[1].turn.id);
  assert.deepEqual(replay[0].params, replay[1].params);
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
  adapter.close();

  const beforeManual = native.completed();
  await native.call('turn/start', { threadId: native.thread.id, input: [{ type: 'text', text: 'owner still controls session', text_elements: [] }] });
  await until(() => native.completed() > beforeManual);
  const matrix = await matrixFixture(context, native.workspace);
  const stop = new AbortController();
  const receiving = listen({ ...matrix, limit: 2, pollMs: 100, codex: native.options }, stop.signal).catch(error => error);
  context.after(async () => { stop.abort(new Error('verification complete')); await receiving; });
  await until(() => matrix.waiting() === 1);
  native.hold();
  await native.call('turn/start', { threadId: native.thread.id, input: [{ type: 'text', text: 'hold during Matrix burst', text_elements: [] }] });
  await until(() => native.held() !== undefined);
  const beforeBurst = native.acknowledgements().length;
  matrix.add(ROOM, ...Array.from({ length: 6 }, (_, index) => message('$native-' + index, undefined, 'Matrix burst ' + index)));
  await until(() => native.acknowledgements().length > beforeBurst);
  assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], '0');
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
  console.log('PASS native receipts, busy delivery, interrupted input, already-recorded cancellation, original tool control, relay disconnect, and Matrix burst recovery.');
});
