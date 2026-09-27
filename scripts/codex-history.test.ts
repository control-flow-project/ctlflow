import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectCodex } from '../skills/conduit-chat/scripts/codex.ts';
import { listen } from '../skills/conduit-chat/scripts/listen.ts';
import { fakeCodex, inputReceipt, matrixFixture, message, ROOM, THREAD, until } from './test-support/listener.ts';

function oldHistory(count: number, completed = true) {
  return [
    { type: 'turnStarted', turnId: 'old-turn', position: 1 },
    ...Array.from({ length: count }, (_, index) => ({ type: 'item', turnId: 'old-turn', position: index + 2,
      item: { type: 'agentMessage', id: 'old-' + index, text: 'historical output' } })),
    ...(completed ? [{ type: 'turnCompleted', turnId: 'old-turn', position: count + 2, status: 'completed' }] : []),
  ];
}

test('acknowledgement before publication never scans unrelated large history or submits twice', async context => {
  const native = await fakeCodex(context, { initialHistory: oldHistory(10_100), deferHistory: true });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  let delivered = false;
  const delivery = connection.deliver('input', 'delayed').then(() => { delivered = true; });
  const reads = () => native.requests().filter(request => request.method === 'thread/timeline/list');
  await until(() => reads().filter(request => request.params!.limit === 100).length >= 3);
  assert.equal(delivered, false);
  assert(reads().every(request => !request.params!.cursor));
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  native.publish();
  await delivery;
  assert(reads().length <= 5);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('a long active turn needs only its post-submission interval to prove interruption', async context => {
  const native = await fakeCodex(context, { initialHistory: oldHistory(10_100, false), mode: 'accepted', turnId: 'old-turn' });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  const delivery = connection.deliver('input', 'interrupted-long');
  await until(() => native.requests().some(request => request.method === 'thread/timeline/list' && request.params!.limit === 100));
  native.update({ mode: 'normal', turnId: 'new-turn' });
  native.notify('turn/completed', { threadId: THREAD, turn: { id: 'old-turn', status: 'interrupted' } });
  await delivery;
  const starts = native.requests().filter(request => request.method === 'turn/start');
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0].params, starts[1].params);
  assert(native.requests().filter(request => request.method === 'thread/timeline/list').every(request => !request.params!.cursor));
});

test('completed intervals advance a bounded in-memory boundary instead of rescanning the active turn', async context => {
  const native = await fakeCodex(context, { initialHistory: oldHistory(10_100, false), mode: 'accepted', turnId: 'old-turn' });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  const delivery = connection.deliver('input', 'incremental');
  const reads = () => native.requests().filter(request => request.method === 'thread/timeline/list' && request.params!.limit === 100);
  await until(() => reads().length >= 1);
  for (let batch = 0; batch < 3; batch++) {
    const before = reads().length;
    for (let index = 0; index < 150; index++) {
      native.notify('item/completed', { threadId: THREAD, item: { type: 'agentMessage', id: `batch-${batch}-${index}`, text: 'output' } });
    }
    await until(() => reads().length >= before + 2);
    await connection.verify();
    assert.equal(reads().slice(before).filter(request => request.params!.cursor).length, 1);
  }
  const before = reads().length;
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt('incremental') });
  await delivery;
  assert.equal(reads().slice(before).filter(request => request.params!.cursor).length, 0);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('an exact receipt published after a page snapshot is found on the next poll', async context => {
  const history = oldHistory(200);
  const native = await fakeCodex(context, { initialHistory: history, historyPages: [
    { data: history.slice(-100), nextCursor: 'older-snapshot' },
  ] });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  await connection.deliver('input', 'snapshot');
  const reads = native.requests().filter(request => request.method === 'thread/timeline/list' && request.params!.limit === 100);
  assert.equal(reads.length, 2);
  assert(reads.every(request => !request.params!.cursor));
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('fresh unavailable history is not mistaken for receipt or replay permission', async context => {
  const native = await fakeCodex(context, { boundaryUnavailable: [-32601], historyUnavailable: [-32601, -32601] });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  await connection.deliver('input', 'fresh');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert.equal(native.requests().filter(request => request.method === 'thread/timeline/list').length, 4);
});

test('invalid submission boundaries fail before input and never search older history', async context => {
  const badPages = [
    { data: [], nextCursor: 'not-empty' },
    { data: [], nextCursor: '' },
    { data: [], nextCursor: 1 },
    { data: 'invalid', nextCursor: null },
    { data: oldHistory(1), nextCursor: null },
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null].map(position => ({
      data: [{ type: 'turnStarted', turnId: 'old-turn', position }], nextCursor: null,
    })),
    { data: [{ type: 'unknown', turnId: 'old-turn', position: 1 }], nextCursor: null },
    { data: [{ type: 'item', turnId: 'old-turn', position: 1, item: { type: 'agentMessage' } }], nextCursor: null },
    { data: [{ type: 'turnStarted', turnId: null, position: 1 }], nextCursor: null },
  ];
  for (const page of badPages) {
    const native = await fakeCodex(context, { boundaryPages: [page] });
    const connection = await connectCodex(native.options, new AbortController().signal);
    try {
      await assert.rejects(connection.deliver('input', 'invalid-boundary'), /Invalid Codex/);
      assert(!native.requests().some(request => request.method === 'turn/start'));
      assert.equal(native.requests().filter(request => request.method === 'thread/timeline/list').length, 1);
    } finally { connection.close(); }
  }
});

test('a missing, changed, truncated or regressing boundary cannot prove absence or allow replay', async context => {
  const history = oldHistory(1);
  const completion = { type: 'turnCompleted', turnId: 'current', position: 5, status: 'interrupted' };
  const invalidPages = [
    { data: [], nextCursor: null },
    { data: [completion], nextCursor: null },
    { data: [history[0], completion], nextCursor: null },
    { data: [{ ...history.at(-1), turnId: 'different' }, completion], nextCursor: null },
    { data: [completion, history.at(-1)], nextCursor: null },
    { data: [completion, completion], nextCursor: null },
  ];
  for (const page of invalidPages) {
    const native = await fakeCodex(context, { initialHistory: history, turnId: 'current', mode: 'accepted', historyPages: [page] });
    const connection = await connectCodex(native.options, new AbortController().signal);
    try {
      await assert.rejects(connection.deliver('input', 'input'), /boundary|history order/);
      assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
    } finally { connection.close(); }
  }
});

test('cursor cycles and excessive new intervals remain bounded and never authorize retry', async context => {
  for (const cyclic of [false, true]) {
    const pages = Array.from({ length: 100 }, (_, index) => ({ data: [{
      type: 'item', turnId: 'current', position: 300 - index,
      item: { type: 'agentMessage', id: 'item-' + index, text: 'output' },
    }], nextCursor: cyclic ? 'cycle' : 'page-' + index }));
    const native = await fakeCodex(context, { mode: 'accepted', turnId: 'current', historyPages: pages });
    const connection = await connectCodex(native.options, new AbortController().signal);
    try {
      await assert.rejects(connection.deliver('input', 'input'), cyclic ? /history cursor/ : /verification bound/);
      assert.equal(native.requests().filter(request => request.method === 'thread/timeline/list' && request.params!.limit === 100).length, cyclic ? 2 : 100);
      assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
    } finally { connection.close(); }
  }
});

test('realtime entries and coincident positions retain exact boundary identity', async context => {
  const native = await fakeCodex(context, { initialHistory: [
    { type: 'turnStarted', turnId: 'old-turn', position: 1 },
    { type: 'realtime', position: 1, item: { type: 'realtimeSessionStarted', id: 'realtime', realtimeSessionId: 'session' } },
  ], turnId: 'current', mode: 'accepted', historyPages: [{ data: [
    { type: 'turnStarted', turnId: 'old-turn', position: 1 },
    { type: 'realtime', position: 1, item: { type: 'realtimeSessionStarted', id: 'realtime', realtimeSessionId: 'session' } },
    { type: 'turnStarted', turnId: 'current', position: 1 },
  ], nextCursor: null }] });
  const connection = await connectCodex(native.options, new AbortController().signal);
  context.after(connection.close);
  const delivery = connection.deliver('input', 'realtime');
  await until(() => native.requests().some(request => request.method === 'thread/timeline/list' && request.params!.limit === 100));
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt('realtime') });
  await delivery;
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('Matrix cursors remain unread during native publication lag and later drain all rooms', async context => {
  const native = await fakeCodex(context, { initialHistory: oldHistory(10_100), deferHistory: true });
  const matrix = await matrixFixture(context, native.directory);
  const other = '!other:test.localhost';
  matrix.joined.add(other);
  matrix.add(ROOM, message('$first'));
  matrix.add(other, message('$second'));
  const stop = new AbortController();
  const receiving = listen({ ...matrix, limit: 50, pollMs: 100, debounceMs: 0, codex: native.options }, stop.signal).catch(error => error);
  context.after(async () => { stop.abort(new Error('test complete')); await receiving; });
  await until(() => native.requests().filter(request => request.method === 'thread/timeline/list' && request.params!.limit === 100).length >= 2);
  assert.throws(() => readFileSync(matrix.cursorFile));
  native.publish();
  await until(() => {
    try { const cursors = JSON.parse(readFileSync(matrix.cursorFile, 'utf8')); return cursors[ROOM] === '1' && cursors[other] === '1'; }
    catch { return false; }
  });
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
});
