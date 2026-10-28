import { createMessagingClient } from '@ctlflow/crossfire-adapter-matrix/messaging-client';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { canRecoverFailure } from '@ctlflow/crossfire-kernel/lifecycle';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeObservation } from '@ctlflow/crossfire-adapter-codex/observation';
import { observedEvent } from '@ctlflow/crossfire-adapter-codex/observed-event';
import { ownerObservation } from '@ctlflow/crossfire-agent-core/owner-observation';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { fakeCodex, matrixFixture, OWNER_DM, ROOM, SELF, temporary, until } from '../scripts/test-support/listener.js';
import { testClock } from '../scripts/test-support/clock.js';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { matrix as matrixClient } from '@ctlflow/crossfire-adapter-matrix/http';
import type { MessagingTransport } from '@ctlflow/crossfire-domain/port/messaging-client';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { decisions } from '@ctlflow/crossfire-agent-core/decisions';

test('corrupt owner observations fail permanently and retain exact evidence without recovery or reset', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock);
  const file = matrix.cursorFile + '.observation';
  privateDir(dirname(file));
  for (const text of ['{', 'null', '{"output":[null],"observations":[]}', '{"output":[],"observations":[null]}']) {
    writeFileSync(file, text, { mode: 0o600 });
    assert.throws(() => ownerObservation({ agentId: matrix.id, userId: SELF, file, storage: localState, clock,
      transport: (signal, timeoutMs) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
      coordination: matrix.coordination, historyMode: 'shared', maximum: 65536 }, scope.signal), error => {
      assert(error instanceof Error && 'code' in error); assert.equal(error.code, 'invalid');
      assert.equal(canRecoverFailure(error), false); return true;
    });
    assert.equal(readFileSync(file, 'utf8'), text);
  }
});

test('malformed decision receipts cannot enter automatic recovery or erase retained owner decisions', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock);
  const file = matrix.cursorFile + '.decisions'; privateDir(dirname(file));
  for (const text of ['{', 'null', '[null]', '[{"id":"invalid","native":"original","status":"pending"}]']) {
    writeFileSync(file, text, { mode: 0o600 });
    assert.throws(() => decisions({ clock, client: createMessagingClient(matrixClient({ base: matrix.settings.server,
      token: matrix.account.accessToken, signal: scope.signal, timeoutMs: 1000 }), matrix.account.userId), coordination: matrix.coordination,
      settings: matrix.settings, agent: matrix.id, backendUserId: SELF, run: async () => randomUUID(), storage: localState, file }, scope.signal), error => {
      assert(error instanceof Error && 'code' in error); assert.equal(error.code, 'invalid');
      assert.equal(canRecoverFailure(error), false); return true;
    });
    assert.equal(readFileSync(file, 'utf8'), text);
  }
});

test('cancelled native questions stop waiting for reporting without publishing a decision or granting a choice', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock);
  const stop = new AbortController(), cancelled = new AbortController(); let entered = false;
  const broker = decisions({ clock, client: createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken,
    signal: stop.signal, timeoutMs: 1000 }), matrix.account.userId), coordination: matrix.coordination, settings: matrix.settings,
    agent: matrix.id, backendUserId: SELF, storage: localState, file: matrix.cursorFile + '.decisions',
    run: async signal => {
      entered = true; signal.throwIfAborted();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return randomUUID();
    } }, stop.signal);
  cleanup(scope, async () => { cancelled.abort(); stop.abort(); await broker.close(); });
  const result = broker.request({ runtime: 'codex', session: 'original', request: 'cancelled', turn: 'turn', item: 'item',
    action: 'Review', scope: {}, choices: [{ label: 'Explicit choice', value: { approved: true } }] }, cancelled.signal);
  await until(() => entered); cancelled.abort(new Error('Original native request cancelled'));
  const response = await result; assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.code, 'unavailable');
  assert.equal(broker.unresolved(), false);
  assert.equal(matrix.requests.some(request => request.path.includes('/runtime-decisions') || request.path.includes('/send/')), false);
});

test('current native observations use exact discriminants and never guess alternative output fields', () => {
  const events: RuntimeObservationEvent[] = [], observer = nativeObservation({ requestDecision: async () => { throw new Error('Unexpected decision'); }, observe: event => events.push(event) }, () => 'original');
  const send = (method: string, params: Record<string, unknown>) => observer.event({ method, params: { threadId: 'original', ...params } });
  for (const item of [
    { type: 'mcpToolCall', id: 'mcp', tool: 'extract', result: { content: [{ text: 'extracted' }] }, error: null },
    { type: 'dynamicToolCall', id: 'dynamic', tool: 'lookup', contentItems: [{ type: 'inputText', text: 'current output' }], success: true, result: 'wrong guessed output' },
    { type: 'webSearch', id: 'web', query: 'source', action: { type: 'search', query: 'source' }, results: [], content: 'wrong guessed output' },
    { type: 'imageGeneration', id: 'image', status: 'completed', revisedPrompt: null, result: 'image.png', failure: null },
  ]) send('item/completed', { item });
  send('item/mcpToolCall/progress', { itemId: 'mcp', message: 'progress', delta: 'wrong guessed output' });
  send('item/dynamicToolCall/progress', { itemId: 'unsupported', message: 'uncontracted native progress' });
  send('item/reasoning/textDelta', { delta: 'private reasoning' });
  const output = events.filter(event => event.kind === 'output').map(event => event.text).join('');
  assert(output.includes('current output')); assert(output.includes('progress')); assert(!output.includes('wrong guessed output'));
  assert(!output.includes('uncontracted native progress')); assert(!output.includes('private reasoning'));
  for (const params of [{ status: { type: 'other' } }, { status: { type: 'active', activeFlags: ['other'] } }]) {
    assert.throws(() => observedEvent({ method: 'thread/status/changed', params }), /native thread/u);
  }
  assert.throws(() => send('item/mcpToolCall/progress', { itemId: 'mcp', delta: 'not message' }), /native observation/u);
  assert.throws(() => send('item/completed', { item: { type: 'dynamicToolCall', id: 'd', tool: 'tool', result: 'old guessed output' } }), /native tool/u);
  assert.throws(() => send('turn/completed', { turn: { status: 'unknown', error: null } }), /completion/u);
  send('turn/completed', { turn: { status: 'failed', error: { message: 'native failure' } } });
  const state = events.at(-1); assert(state?.kind === 'state'); assert.equal(state.observation.state, 'failed'); assert.equal(state.observation.errorMessage, 'native failure');
  send('turn/completed', { turn: { status: 'failed', error: { message: '😀'.repeat(3000) } } });
  const bounded = events.at(-1); assert(bounded?.kind === 'state');
  assert.equal(bounded.observation.errorMessage, '😀'.repeat(1000));
  assert.equal(Buffer.byteLength(bounded.observation.errorMessage!), 4000);
});

test('streamed unicode output uses bounded exact prefix evidence rather than retaining full native text', () => {
  const output: string[] = [], observer = nativeObservation({ requestDecision: async () => { throw new Error('Unexpected decision'); }, observe: event => { if (event.kind === 'output') output.push(event.text); } }, () => 'original');
  const send = (method: string, params: Record<string, unknown>) => observer.event({ method, params: { threadId: 'original', ...params } });
  send('item/agentMessage/delta', { itemId: 'unicode', delta: '\ud83d' }); send('item/agentMessage/delta', { itemId: 'unicode', delta: '\ude00' });
  send('item/completed', { item: { id: 'unicode', type: 'agentMessage', text: '😀 completed' } });
  assert.equal(output.join(''), '😀 completed');
  output.length = 0;
  send('item/agentMessage/delta', { itemId: 'mismatch', delta: 'stream' });
  send('item/completed', { item: { id: 'mismatch', type: 'agentMessage', text: 'different final output' } });
  assert.deepEqual(output, ['stream', 'different final output']);
});

test('native terminal observation excludes reasoning and forwards complete streamed and large file output', () => {
  const events: RuntimeObservationEvent[] = [];
  const observer = nativeObservation({ requestDecision: async () => { throw new Error('Unexpected decision'); }, observe: event => events.push(event) }, () => 'original');
  const send = (method: string, params: Record<string, unknown>) => observer.event({ method, params: { threadId: 'original', ...params } });
  send('item/reasoning/textDelta', { itemId: 'thinking', delta: 'private reasoning' });
  send('item/agentMessage/delta', { itemId: 'reply', delta: 'visible ' });
  send('item/completed', { item: { id: 'reply', type: 'agentMessage', text: 'visible complete' } });
  send('item/commandExecution/outputDelta', { itemId: 'command', delta: 'first\n' });
  send('item/completed', { item: { id: 'command', type: 'commandExecution', command: 'fixture', cwd: '/fixture', aggregatedOutput: 'first\nlast\n' } });
  const patch = 'x'.repeat(26036);
  send('item/completed', { item: { id: 'file', type: 'fileChange', changes: [{ path: 'evidence', diff: patch }] } });
  observer.event({ method: 'item/agentMessage/delta', params: { threadId: 'another', itemId: 'foreign', delta: 'wrong session' } });
  const output = events.filter(event => event.kind === 'output').map(event => event.text).join('');
  assert(output.startsWith('visible completefirst\nlast\n')); assert(output.includes(patch));
  assert(!output.includes('private reasoning') && !output.includes('wrong session'));
  send('thread/status/changed', { status: { type: 'active', activeFlags: ['waitingOnUserInput'] } });
  assert.equal(events.at(-1)?.kind, 'state');
  assert.equal((events.at(-1) as Extract<RuntimeObservationEvent, { kind: 'state' }>).observation.state, 'waiting-answer');
});

test('owner output is lazy and durable; one latest-room typing lease expires without renewal', async scope => {
  const clock = testClock(scope), native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController(), file = matrix.cursorFile + '.observation';
  const options = { agentId: matrix.id, userId: SELF, file, storage: localState, clock,
    transport: (signal: AbortSignal, timeoutMs: number) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: matrix.coordination, historyMode: 'shared' as const, maximum: 100000 };
  let observer = ownerObservation(options, stop.signal);
  const state = (value: 'idle' | 'working' | 'waiting-answer') => observer.observe({ kind: 'state', observation: {
    sessionId: 'original', roomId: null, runtime: 'codex', state: value, observedAt: clock.now(), settings: [], errorMessage: null } });
  state('working');
  assert(!matrix.requests.some(request => request.path.endsWith('/owner-conversation')));
  observer.observe({ kind: 'output', sessionId: 'original', id: 'visible', streamId: null, text: '😀'.repeat(13000) });
  await observer.close();
  assert(!matrix.requests.some(request => request.path.includes('/send/')));
  observer = ownerObservation(options, stop.signal);
  observer.start(randomUUID());
  cleanup(scope, async () => { stop.abort(); await clock.complete(observer.close()); });
  await until(() => matrix.requests.filter(request => request.path.includes('/send/') && request.path.includes(OWNER_DM)).length === 2);
  const posted = matrix.requests.filter(request => request.path.includes('/send/') && request.path.includes(OWNER_DM));
  assert.equal(posted.map(request => (request.body as { body: string }).body).join(''), '😀'.repeat(13000));
  state('working'); await observer.delivered(ROOM, 'original');
  state('waiting-answer');
  const typing = () => matrix.requests.filter(request => request.path.includes('/typing/'));
  assert.deepEqual(typing().map(request => request.body), [{ typing: true, timeout: 30000 }]);
  await clock.advance(30001); state('working');
  assert.equal(typing().length, 1, 'Native expiry is not extended by polling or state changes');
  await observer.delivered(ROOM, 'original'); await observer.delivered(OWNER_DM, 'original');
  assert.deepEqual(typing().slice(-3).map(request => request.body), [{ typing: true, timeout: 30000 }, { typing: false }, { typing: true, timeout: 30000 }]);
  state('idle'); await until(() => !!typing().at(-1)?.body && (typing().at(-1)!.body as { typing: boolean }).typing === false);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});

test('steering receipts flush without waiting for blocked runtime telemetry and survive an outbox restart', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock);
  const stop = new AbortController();
  let entered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const options = { agentId: matrix.id, userId: SELF, file: matrix.cursorFile + '.observation', storage: localState, clock,
    transport: (signal: AbortSignal, timeoutMs: number) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: { ...matrix.coordination, runtime: async (...args: Parameters<typeof matrix.coordination.runtime>) => {
      entered = true; await gate; return matrix.coordination.runtime(...args);
    } }, historyMode: 'shared' as const, maximum: 65536 };
  let observer = ownerObservation(options, stop.signal);
  observer.observe({ kind: 'state', observation: { runtime: 'codex', sessionId: 'original', roomId: null, state: 'idle',
    observedAt: 0, settings: [], errorMessage: null } });
  observer.notice('steering-received', 'Mention received');
  await observer.close();
  observer = ownerObservation(options, stop.signal);
  observer.start(randomUUID());
  cleanup(scope, async () => { release(); stop.abort(); await clock.complete(observer.close()); });
  await until(() => entered);
  await until(() => matrix.requests.some(request => request.path.includes('/send/') && request.path.includes(OWNER_DM)));
  assert.equal(clock.now(), 0); assert.equal(observer.busy(), false);
  const sent = matrix.requests.find(request => request.path.includes('/send/') && request.path.includes(OWNER_DM))!;
  assert.equal((sent.body as { body: string }).body, 'Mention received');
  observer.notice('steering-accepted', 'Native input accepted');
  await until(() => matrix.requests.filter(request => request.path.includes('/send/')).length === 2);
  assert.equal(clock.now(), 0, 'Receipt flushing must not depend on the telemetry request or periodic clock');
});

test('an unavailable owner conversation retains receipts and retries on its bounded clock without spinning', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock), stop = new AbortController();
  let ready = false, attempts = 0;
  const observer = ownerObservation({ agentId: matrix.id, userId: SELF, file: matrix.cursorFile + '.observation', storage: localState, clock,
    transport: (signal, timeoutMs) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: { ...matrix.coordination, ownerConversation: async (...args) => {
      attempts++;
      return ready ? matrix.coordination.ownerConversation(...args) : failure('unavailable', 'Owner conversation is temporarily unavailable');
    } }, historyMode: 'shared', maximum: 65536 }, stop.signal);
  cleanup(scope, async () => { stop.abort(); await clock.complete(observer.close()); });
  observer.notice('steering-received', 'Mention received'); observer.start(randomUUID());
  const sent = () => matrix.requests.filter(request => request.path.includes('/send/') && request.path.includes(OWNER_DM));
  await until(() => attempts > 0);
  await clock.advance(999);
  assert.equal(attempts, 1); assert.equal(sent().length, 0);
  ready = true; await clock.advance(1);
  await until(() => sent().length === 1);
  assert.equal(attempts, 2); assert.equal(observer.busy(), false);
  assert.equal((sent()[0]!.body as { body: string }).body, 'Mention received');
});

test('owner streams coalesce before publication and uncertain delivery retries an immutable body', async scope => {
  const clock = testClock(scope), native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController();
  let uncertain = true;
  const transport: MessagingTransport = (signal, timeoutMs) => {
    const client = matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs });
    return createMessagingClient({ ...client, async put<Value>(path: string, body: unknown): Promise<Value> {
      const result = await client.put<Value>(path, body);
      if (path.includes('/send/') && uncertain) { uncertain = false; throw new Error('Receipt lost after native publication'); }
      return result;
    } }, matrix.account.userId);
  };
  const observer = ownerObservation({ agentId: matrix.id, userId: SELF, file: matrix.cursorFile + '.observation', storage: localState, clock,
    transport, coordination: matrix.coordination, historyMode: 'shared', maximum: 100000 }, stop.signal);
  cleanup(scope, async () => { stop.abort(); await clock.complete(observer.close()); });
  for (let position = 0; position < 100; position++) observer.observe({ kind: 'output', sessionId: 'original', streamId: 'native-item',
    id: 'delta-' + position, text: 'word-' + position + ' ' });
  observer.start(randomUUID());
  const sent = () => matrix.requests.filter(request => request.path.includes('/send/') && request.path.includes(OWNER_DM));
  await until(() => !uncertain);
  const first = sent()[0]!;
  observer.observe({ kind: 'output', sessionId: 'original', streamId: 'native-item', id: 'later-delta', text: 'later' });
  await clock.until(() => sent().length === 3);
  assert.equal(sent()[1]?.path, first.path);
  assert.deepEqual(sent()[1]?.body, first.body);
  assert.equal((first.body as { body: string }).body, Array.from({ length: 100 }, (_, position) => 'word-' + position + ' ').join(''));
  assert.equal((sent()[2]!.body as { body: string }).body, 'later');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});

test('a new reporting run republishes every retained native state without another native event or owner message', async scope => {
  const clock = testClock(scope), native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController();
  const run = randomUUID();
  let awaitingReceipt!: () => void, acknowledge!: () => void;
  const awaiting = new Promise<void>(resolve => { awaitingReceipt = resolve; });
  const receipt = new Promise<void>(resolve => { acknowledge = resolve; });
  const observer = ownerObservation({ agentId: matrix.id, userId: SELF, file: matrix.cursorFile + '.observation', storage: localState, clock,
    transport: (signal, timeoutMs) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: { ...matrix.coordination, async runtime(...args) {
      const result = await matrix.coordination.runtime(...args);
      if (args[1] === run && args[2].sessionId === 'room-two') { awaitingReceipt(); await receipt; }
      return result;
    } }, historyMode: 'per-room', maximum: 100000 }, stop.signal);
  cleanup(scope, async () => { acknowledge(); stop.abort(); await clock.complete(observer.close()); });
  for (const sessionId of ['shared', 'room-one', 'room-two']) observer.observe({ kind: 'state', observation: {
    sessionId, roomId: sessionId === 'shared' ? null : '!' + sessionId + ':test', runtime: 'codex', state: 'idle', observedAt: clock.now(),
    settings: [{ name: 'model', configured: 'example', effective: 'example' }], errorMessage: null } });
  observer.start(run);
  const posted = () => matrix.requests.filter(request => request.path.endsWith('/runtime'));
  await clock.until(() => posted().length === 3);
  await awaiting;
  const next = randomUUID(); observer.start(next);
  acknowledge();
  await clock.until(() => posted().length === 6);
  assert(posted().slice(0, 3).every(request => request.path.includes(run)));
  assert(posted().slice(3).every(request => request.path.includes(next)));
  assert.deepEqual(posted().slice(3).map(request => request.body), posted().slice(0, 3).map(request => request.body));
  observer.start(next); await clock.advance(1001);
  assert.equal(posted().length, 6, 'The same run does not generate another snapshot');
  assert.equal(matrix.requests.filter(request => request.path.includes('/owner-conversation')).length, 0);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});

test('observation coalescing never removes a snapshot while its publication is awaiting a receipt', async scope => {
  const clock = testClock(scope), native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController();
  let received!: () => void, proceed!: () => void;
  const publication = new Promise<void>(resolve => { received = resolve; }), receipt = new Promise<void>(resolve => { proceed = resolve; });
  let first = true;
  const observer = ownerObservation({ agentId: matrix.id, userId: SELF, file: matrix.cursorFile + '.observation', storage: localState, clock,
    transport: (signal, timeoutMs) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: { ...matrix.coordination, async runtime(...args) {
      if (first) { first = false; received(); await receipt; }
      return matrix.coordination.runtime(...args);
    } }, historyMode: 'shared', maximum: 100000 }, stop.signal);
  cleanup(scope, async () => { proceed(); stop.abort(); await clock.complete(observer.close()); });
  const state = (observedAt: number) => observer.observe({ kind: 'state', observation: {
    sessionId: 'original', roomId: null, runtime: 'codex', state: 'idle', observedAt, settings: [], errorMessage: null } });
  state(1); observer.start(randomUUID()); await publication;
  state(2); proceed();
  const posted = () => matrix.requests.filter(request => request.path.endsWith('/runtime'));
  await clock.until(() => posted().length === 2);
  assert.deepEqual(posted().map(request => (request.body as { observedAt: number }).observedAt), [1, 2]);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});

test('quiet native output leaves telemetry and explicit notices active without per-tool owner messages', async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock), stop = new AbortController();
  const file = matrix.cursorFile + '.observation';
  const observer = ownerObservation({ agentId: matrix.id, userId: SELF, file, storage: localState, clock,
    transport: (signal, timeoutMs) => createMessagingClient(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken, signal, timeoutMs }), matrix.account.userId),
    coordination: matrix.coordination, historyMode: 'shared', mirrorOutput: false, maximum: 65536 }, stop.signal);
  cleanup(scope, async () => { stop.abort(); await clock.complete(observer.close()); });
  observer.observe({ kind: 'state', observation: { sessionId: 'original', roomId: null, runtime: 'codex', state: 'working',
    observedAt: clock.now(), settings: [], errorMessage: null } });
  for (let index = 0; index < 500; index++) observer.observe({ kind: 'output', sessionId: 'original', id: 'fetch-' + index, streamId: null, text: 'Fetched item ' + index });
  assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as { output: unknown[] }).output, []);
  assert.equal(observer.busy(), true);
  assert.equal(matrix.requests.some(request => request.path.includes('/owner-conversation') || request.path.includes('/send/')), false);
  observer.notice('important', 'Owner action required'); observer.start(randomUUID());
  await clock.until(() => matrix.requests.some(request => request.path.endsWith('/runtime')) && matrix.requests.some(request => request.path.includes('/send/')));
  assert.deepEqual(matrix.requests.filter(request => request.path.includes('/send/')).map(request => (request.body as { body: string }).body), ['Owner action required']);
});
