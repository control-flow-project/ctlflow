import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCodex } from '../skills/conduit-chat/scripts/codex.ts';
import { fakeCodex, THREAD } from './test-support/listener.ts';

test('native delivery verifies the selected workspace and uses only start-or-steer without policy overrides', async t => {
  const fixture = await fakeCodex(t);
  const connection = await connectCodex(fixture.options, new AbortController().signal);
  t.after(connection.close);
  await connection.deliver('idle input', 'first');
  fixture.update({ status: 'active' });
  await connection.deliver('active input', 'second');
  assert.deepEqual(fixture.requests().map(request => request.method),
    ['initialize', 'initialized', 'thread/read', 'thread/read', 'turn/start', 'thread/read', 'turn/start']);
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
  assert.deepEqual(fixture.requests(), []);
});
