import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { connectCodex } from '../skills/conduit-chat/scripts/codex.ts';
import { fakeCodex, inputReceipt, THREAD, until } from './test-support/listener.ts';

test('native delivery verifies the selected workspace and uses only start-or-steer without policy overrides', async t => {
  const fixture = await fakeCodex(t);
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  t.after(connection.close);
  await connection.deliver('idle input', 'first');
  fixture.update({ status: 'active' });
  await connection.deliver('active input', 'second');
  assert.deepEqual(fixture.requests().map(request => request.method),
    ['initialize', 'initialized', 'thread/read', 'thread/read', 'thread/timeline/list', 'turn/start', 'thread/timeline/list',
      'thread/read', 'thread/timeline/list', 'turn/start', 'thread/timeline/list']);
  const starts = fixture.requests().filter(request => request.method === 'turn/start');
  assert.deepEqual(starts.map(request => request.params), ['idle input', 'active input'].map((text, index) => ({
    threadId: THREAD, clientUserMessageId: index === 0 ? 'first' : 'second',
    input: [{ type: 'text', text, text_elements: [] }],
  })));
});

test('delivery rejects absent, foreign, or noninteractive threads without resuming them', async t => {
  for (const configuration of [{ status: 'notLoaded' }, { status: 'systemError' }, { directInput: false },
    { directInput: null }, { thread: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }, { workspace: '/missing-workspace' }]) {
    const fixture = await fakeCodex(t, configuration);
    await assert.rejects(connectCodex(fixture.options, new AbortController().signal).then(connection => { connection.close(); return connection; }));
    assert(!fixture.requests().some(request => request.method?.startsWith('turn/')));
    assert(!fixture.requests().some(request => ['thread/start', 'thread/resume', 'thread/fork'].includes(request.method ?? '')));
  }
});

test('the thread is checked again before each input', async t => {
  const fixture = await fakeCodex(t);
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  t.after(connection.close);
  fixture.update({ directInput: false });
  await assert.rejects(connection.deliver('blocked', 'blocked'), /not loaded for direct input/);
  assert(!fixture.requests().some(request => request.method === 'turn/start'));
});

test('protocol notifications and approval requests are never answered by the chat client', async t => {
  const fixture = await fakeCodex(t, { mode: 'server-requests' });
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  t.after(connection.close);
  await connection.deliver('input', 'input');
  await connection.verify();
  assert(!fixture.requests().some(request => request.id === 'approval' || !request.method));
});

test('invalid protocol responses fail promptly and do not leave unresolved requests', async t => {
  for (const mode of ['invalid-json', 'malformed-error', 'unexpected-id', 'oversized']) {
    const fixture = await fakeCodex(t, { mode });
    await assert.rejects(connectCodex(fixture.options, new AbortController().signal),
      error => error instanceof Error && !error.message.includes('timed out'));
  }
});

test('rejected, missing, lost, and timed-out acknowledgements never retry native input', async t => {
  for (const mode of ['reject', 'missing-turn', 'disconnect', 'timeout']) {
    const fixture = await fakeCodex(t, { mode });
    const connection = await connectCodex({ ...fixture.options, timeoutMs: 500 }, new AbortController().signal);
    try {
      await assert.rejects(connection.deliver('input', 'stable-id'));
      assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
    } finally { connection.close(); }
  }
});

test('cancellation stops a pending native request', async t => {
  const fixture = await fakeCodex(t, { mode: 'timeout' });
  const controller = new AbortController();
  const connection = await connectCodex(fixture.options, controller.signal);
  const delivery = connection.deliver('input', 'input');
  controller.abort(new Error('cancelled by test'));
  await assert.rejects(delivery, /cancelled by test/);
  assert.equal(connection.signal.aborted, true);
  connection.close();
});

test('invalid destinations and unavailable executables fail before native requests', async t => {
  const fixture = await fakeCodex(t);
  const signal = new AbortController().signal;
  await assert.rejects(connectCodex({ ...fixture.options, thread: 'latest' }, signal), /exact Codex thread UUID/);
  await assert.rejects(connectCodex({ ...fixture.options, socket: 'relative.sock' }, signal), /absolute path/);
  await assert.rejects(connectCodex({ ...fixture.options, binary: '/no-such-codex' }, signal), /Cannot connect/);
  for (const pollMs of [0, 99, 30_001, NaN, Infinity]) {
    await assert.rejects(connectCodex({ ...fixture.options, pollMs }, signal), /poll interval/);
  }
  assert.deepEqual(fixture.requests(), []);
});

test('acceptance is not receipt: only the exact completed native user item acknowledges input', async context => {
  const fixture = await fakeCodex(context, { mode: 'accepted' });
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  context.after(connection.close);
  let delivered = false;
  const delivery = connection.deliver('input', 'exact').then(() => { delivered = true; });
  await until(() => fixture.requests().some(request => request.method === 'turn/start'));
  await assert.rejects(connection.deliver('concurrent', 'other'), /must be sequential/);
  fixture.notify('item/completed', { threadId: 'another-thread', item: inputReceipt('exact') });
  fixture.notify('item/completed', { threadId: THREAD, item: inputReceipt('other') });
  fixture.notify('item/started', { threadId: THREAD, item: inputReceipt('exact') });
  await connection.verify();
  assert.equal(delivered, false);
  fixture.notify('item/completed', { threadId: THREAD, item: inputReceipt('exact') });
  await delivery;
  assert.equal(delivered, true);
  assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('history receipts acknowledge input without detailed event subscriptions', async context => {
  const fixture = await fakeCodex(context, { receiptFirst: true });
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  context.after(connection.close);
  await connection.deliver('input', 'early');
  assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
  assert(fixture.requests().some(request => request.method === 'thread/timeline/list'));
});

test('busy receipt checks are bounded polls, not additional model turns or turn-duration timeouts', async context => {
  const fixture = await fakeCodex(context, { mode: 'accepted' });
  const connection = await connectCodex({ ...fixture.options, timeoutMs: 100 }, new AbortController().signal);
  context.after(connection.close);
  const delivery = connection.deliver('input', 'waiting');
  await until(() => fixture.requests().some(request => request.method === 'turn/start'));
  await until(() => fixture.requests().some(request => request.method === 'thread/timeline/list' && request.params!.limit === 100));
  const count = fixture.requests().length;
  await delay(150);
  assert(fixture.requests().length > count && fixture.requests().length <= count + 2);
  assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
  assert.equal(connection.signal.aborted, false);
  fixture.notify('item/completed', { threadId: THREAD, item: inputReceipt('waiting') });
  await delivery;
});

test('interrupted input is retried only after complete bounded history proves it absent', async context => {
  const fixture = await fakeCodex(context, { mode: 'accepted' });
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  context.after(connection.close);
  const delivery = connection.deliver('input', 'interrupted');
  await until(() => fixture.requests().some(request => request.method === 'thread/timeline/list' && request.params!.limit === 100));
  fixture.update({ mode: 'normal', turnId: 'replacement-turn', historyPages: [
    { data: [{ type: 'item', turnId: 'existing-turn', position: 2, item: inputReceipt('other') },
      { type: 'turnCompleted', turnId: 'existing-turn', position: 3, status: 'interrupted' }], nextCursor: 'next' },
    { data: [{ type: 'turnStarted', turnId: 'existing-turn', position: 1 }], nextCursor: null },
  ] });
  fixture.notify('turn/completed', { threadId: THREAD, turn: { id: 'existing-turn', status: 'interrupted' } });
  await delivery;
  const starts = fixture.requests().filter(request => request.method === 'turn/start');
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0].params, starts[1].params);
  const reads = fixture.requests().filter(request => request.method === 'thread/timeline/list');
  const paged = reads.findIndex(request => request.params!.cursor === 'next');
  assert(paged > 0);
  assert.deepEqual(reads.slice(paged - 1, paged + 1).map(request => request.params), [
    { threadId: THREAD, limit: 100 },
    { threadId: THREAD, limit: 100, cursor: 'next' },
  ]);
});

test('history receipts prevent retries even when interruption precedes the start response', async context => {
  const fixture = await fakeCodex(context, { mode: 'accepted', completionFirst: true, historyPages: [
    { data: [{ type: 'turnCompleted', turnId: 'existing-turn', position: 3, status: 'interrupted' }], nextCursor: 'older' },
    { data: [{ type: 'turnStarted', turnId: 'existing-turn', position: 1 },
      { type: 'item', turnId: 'existing-turn', position: 2, item: inputReceipt('persisted') }], nextCursor: null },
  ] });
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  context.after(connection.close);
  await connection.deliver('input', 'persisted');
  assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
});

test('uncertain, malformed, foreign, cyclic, or excessive history cannot authorize replay', async context => {
  const configurations = [
    { historyError: true },
    { historyPages: [{ data: [], nextCursor: '' }] },
    { historyPages: [{ data: [], nextCursor: 'cycle' }, { data: [], nextCursor: 'cycle' }] },
    { historyPages: [{ data: [], nextCursor: undefined }] },
    { historyPages: [{ data: 'invalid', nextCursor: null }] },
    { historyPages: Array.from({ length: 3 }, () => ({ data: [{ type: 'item', turnId: 'foreign', position: 1, item: inputReceipt('input') }], nextCursor: null })) },
    { historyPages: Array.from({ length: 3 }, () => ({ data: [{ type: 'turnCompleted', turnId: 'existing-turn', position: 2, status: 'interrupted' }], nextCursor: null })) },
    { historyPages: [{ data: [{ type: 'item', turnId: 'existing-turn', position: 2, item: inputReceipt('input', []) }], nextCursor: null }] },
    { historyPages: [{ data: [{ type: 'turnCompleted', turnId: 'existing-turn', position: 2, status: 'interrupted' },
      { type: 'turnStarted', turnId: 'existing-turn', position: 1 }], nextCursor: null }] },
    { historyPages: [{ data: Array.from({ length: 101 }, () => ({ turnId: 'existing-turn', item: inputReceipt('other') })), nextCursor: null }] },
    { historyPages: Array.from({ length: 100 }, (_, index) => ({ data: [], nextCursor: 'page-' + index })) },
  ];
  for (const configuration of configurations) {
    const fixture = await fakeCodex(context, { mode: 'accepted' });
    const connection = await connectCodex(fixture.options, new AbortController().signal);
    const rejection = assert.rejects(connection.deliver('input', 'input'));
    await until(() => fixture.requests().some(request => request.method === 'thread/timeline/list' && request.params!.limit === 100));
    fixture.update(configuration);
    fixture.notify('turn/completed', { threadId: THREAD, turn: { id: 'existing-turn', status: 'interrupted' } });
    await rejection;
    assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
    connection.close();
  }
});

test('successful or failed turns without input evidence stop instead of resubmitting', async context => {
  for (const status of ['completed', 'failed']) {
    const fixture = await fakeCodex(context, { mode: 'accepted' });
    const connection = await connectCodex(fixture.options, new AbortController().signal);
    const rejection = assert.rejects(connection.deliver('input', 'input'), /without recording the input/);
    await until(() => fixture.requests().some(request => request.method === 'turn/start'));
    fixture.notify('turn/completed', { threadId: THREAD, turn: { id: 'existing-turn', status } });
    await rejection;
    assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
    connection.close();
  }
});

test('mismatched receipts, cancellation, and disconnect release a pending receipt wait without retry', async context => {
  for (const mode of ['wrong-content', 'cancel', 'disconnect']) {
    const fixture = await fakeCodex(context, { mode: 'accepted' });
    const controller = new AbortController();
    const connection = await connectCodex(fixture.options, controller.signal);
    const rejection = assert.rejects(connection.deliver('input', 'input'));
    await until(() => fixture.requests().some(request => request.method === 'turn/start'));
    if (mode === 'wrong-content') fixture.notify('item/completed', { threadId: THREAD,
      item: inputReceipt('input', [{ type: 'text', text: 'different input', text_elements: [] }]) });
    else if (mode === 'cancel') controller.abort(new Error('cancelled by test'));
    else fixture.disconnect();
    await rejection;
    assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
    if (mode !== 'wrong-content') assert.equal(connection.signal.aborted, true);
    connection.close();
  }
});

test('missing or malformed turn history never proves interruption or permits replay', async context => {
  for (const data of [[], [{ type: 'turnCompleted', turnId: 'existing-turn', position: 1, status: 'unknown' }],
    [{ type: 'unknown', turnId: 'existing-turn', position: 1 }]]) {
    const fixture = await fakeCodex(context, { mode: 'accepted', historyPages: Array.from({ length: 3 }, () => ({ data, nextCursor: null })) });
    const connection = await connectCodex(fixture.options, new AbortController().signal);
    context.after(connection.close);
    await assert.rejects(connection.deliver('input', 'input'), /turn/);
    assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
  }
});

test('new-thread history initialization permits only bounded read-only retries, never another input', async context => {
  for (const count of [2, 3]) {
    const fixture = await fakeCodex(context, { historyUnavailable: Array.from({ length: count }, () => -32601) });
    const connection = await connectCodex(fixture.options, new AbortController().signal);
    context.after(connection.close);
    if (count === 2) await connection.deliver('input', 'input');
    else await assert.rejects(connection.deliver('input', 'input'), /not supported yet/);
    assert.equal(fixture.requests().filter(request => request.method === 'thread/timeline/list' && request.params!.limit === 100).length, 3);
    assert.equal(fixture.requests().filter(request => request.method === 'turn/start').length, 1);
  }
});
