import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { applyNativeInstructions } from '@ctlflow/crossfire-adapter-codex/instructions';
import { instructionCapability } from '@ctlflow/crossfire-adapter-codex/capability';
import { openSession, type CodexSession } from '@ctlflow/crossfire-adapter-codex/session';
import { captureHistory, historySince } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { fakeCodex, THREAD } from '../scripts/test-support/listener.js';

function fixture(scope: TestContext) {
  const workspace = mkdtempSync(join(tmpdir(), 'crossfire-instructions-'));
  cleanup(scope, () => rmSync(workspace, { recursive: true, force: true }));
  const home = join(workspace, 'home'), sessions = join(home, 'sessions'), path = join(sessions, 'native-rollout.jsonl');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(sessions, { mode: 0o700 });
  const journal = join(home, 'instructions.json'), signal = new AbortController();
  const requests: { method: string; params: unknown }[] = [];
  let reportedPath = path, accepted = true, loseReply = false, role = 'developer', textOverride: string | undefined;
  function header() {
    writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id: THREAD, cwd: workspace } }) + '\n', { mode: 0o664 });
  }
  const session: CodexSession = { sessionId: THREAD, workspace, signal: signal.signal, approval: 'listener', close: async () => {},
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === 'thread/read') return { thread: { id: THREAD, cwd: workspace, path: reportedPath, status: { type: 'idle' }, canAcceptDirectInput: true } };
      assert.equal(method, 'thread/inject_items', 'Instructions must never start a model turn or use another configuration owner');
      const input = params as { threadId: string; items: { id: string; type: string; role: string; content: { type: string; text: string }[] }[] };
      assert.equal(input.threadId, THREAD); assert.equal(input.items.length, 1);
      assert.equal(input.items[0]!.role, 'developer'); assert.equal(input.items[0]!.type, 'message');
      if (accepted) {
        if (!existsSync(path)) header();
        const item = structuredClone(input.items[0]!); item.role = role;
        if (textOverride !== undefined) item.content[0]!.text = textOverride;
        appendFileSync(path, JSON.stringify({ type: 'response_item', payload: item }) + '\n');
      }
      if (loseReply || !accepted) throw new Error('Uncertain native publication');
      return {};
    } };
  const options = (text: string) => ({ home, journal, text });
  const published = () => requests.filter(request => request.method === 'thread/inject_items');
  return { session, signal, workspace, home, path, journal, header, options, published,
    change(value: { path?: string; accepted?: boolean; loseReply?: boolean; role?: string; text?: string }) {
      reportedPath = value.path ?? reportedPath; accepted = value.accepted ?? accepted; loseReply = value.loseReply ?? loseReply;
      role = value.role ?? role; textOverride = value.text;
    } };
}

test('one native developer item owns each changed role/skill revision; unchanged restart and wake append nothing', async scope => {
  const native = fixture(scope), original = 'Role instructions\n\nCanonical Crossfire SKILL revision 1.';
  await applyNativeInstructions(native.session, native.options(original));
  await applyNativeInstructions({ ...native.session }, native.options(original));
  assert.equal(native.published().length, 1);
  await applyNativeInstructions(native.session, native.options('Role instructions\n\nCanonical Crossfire SKILL revision 2.'));
  await applyNativeInstructions({ ...native.session }, native.options(original));
  assert.equal(native.published().length, 3);
  const items = native.published().flatMap(request => (request.params as { items: { id: string; role: string }[] }).items);
  assert.equal(new Set(items.map(item => item.id)).size, 3, 'Returning to an earlier text creates a distinct new revision, not a reused receipt');
  assert.equal(items.every(item => item.role === 'developer'), true);
  const state = readJson<{ sessionId: string; pending: unknown; confirmed: unknown[] }>(native.journal);
  assert.equal(state.sessionId, THREAD); assert.equal(state.pending, null); assert.equal(state.confirmed.length, 1);
  assert.equal(readFileSync(native.path, 'utf8').split('\n').filter(Boolean).length, 4);
});

test('accepted instructions with a lost native reply recover exact durable evidence without resubmission', async scope => {
  const native = fixture(scope), original = 'Durable role and skill before any model turn.';
  native.change({ loseReply: true });
  await assert.rejects(applyNativeInstructions(native.session, native.options(original)), /Uncertain native publication/u);
  assert.notEqual(readJson<{ pending: unknown }>(native.journal).pending, null);
  native.change({ loseReply: false });
  await applyNativeInstructions({ ...native.session }, native.options(original));
  assert.equal(native.published().length, 1); assert.equal(readJson<{ pending: unknown }>(native.journal).pending, null);
  native.change({ loseReply: true });
  await assert.rejects(applyNativeInstructions(native.session, native.options('Revision 2')), /Uncertain/u);
  native.change({ loseReply: false });
  await applyNativeInstructions({ ...native.session }, native.options('Revision 3'));
  assert.equal(native.published().length, 3, 'The intervening revision is receipt-settled before a distinct new revision is published');
});

test('lost instruction replies recover across long native histories without materializing or limiting the growing tail', async scope => {
  const native = fixture(scope), text = 'Durable instruction receipt before subsequent native turns.';
  native.change({ loseReply: true });
  await assert.rejects(applyNativeInstructions(native.session, native.options(text)), /Uncertain/u);
  const event = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text: 'Long native turn output: ' + '🌿'.repeat(16 * 1024) }] } }) + '\n';
  appendFileSync(native.path, event.repeat(160));
  assert(statSync(native.path).size > 8 * 1024 * 1024);
  const initial = performance.now(); native.change({ loseReply: false });
  await applyNativeInstructions({ ...native.session }, native.options(text));
  await applyNativeInstructions({ ...native.session }, native.options(text));
  assert.equal(native.published().length, 1);
  assert.equal(readJson<{ pending: unknown; confirmed: unknown[] }>(native.journal).pending, null);
  scope.diagnostic('Recovered long native instruction tail in ' + Math.round(performance.now() - initial) + 'ms');
});

test('long native pending tails still reject duplicate and mismatched exact instruction identities', async scope => {
  for (const altered of [false, true]) {
    const native = fixture(scope), text = 'One exact developer instruction identity.';
    native.change({ loseReply: true });
    await assert.rejects(applyNativeInstructions(native.session, native.options(text)), /Uncertain/u);
    const receipt: unknown = JSON.parse(readFileSync(native.path, 'utf8').split('\n')[1]!);
    const duplicate = receipt as { payload: { content: { text: string }[] } };
    if (altered) duplicate.payload.content[0]!.text = 'Different native instruction bytes';
    appendFileSync(native.path, (JSON.stringify({ type: 'native_history', text: 'x'.repeat(64 * 1024) }) + '\n').repeat(160));
    appendFileSync(native.path, JSON.stringify(duplicate) + '\n');
    native.change({ loseReply: false });
    await assert.rejects(applyNativeInstructions({ ...native.session }, native.options(text)), altered ? /differs/u : /more than once/u);
    assert.equal(native.published().length, 1); assert.notEqual(readJson<{ pending: unknown }>(native.journal).pending, null);
  }
});

test('native receipt scans read a fixed snapshot once with chunk/record memory independent of total history length', scope => {
  const native = fixture(scope); native.header();
  const boundary = captureHistory(native.path); assert(boundary);
  const event = JSON.stringify({ type: 'native_history', text: '🌿'.repeat(16 * 1024) }) + '\n';
  for (const count of [16, 160]) {
    writeFileSync(native.path, readFileSync(native.path).subarray(0, boundary.position));
    appendFileSync(native.path, event.repeat(count));
    const snapshot = statSync(native.path).size; let observed = 0;
    const scan = historySince(native.path, boundary, value => {
      assert.equal((value as { type: string }).type, 'native_history'); observed++;
      if (observed === 1) appendFileSync(native.path, '{"type":"after_snapshot"}\n');
    });
    assert.equal(observed, count); assert.equal(scan.records, count);
    assert.equal(scan.bytesRead, snapshot - boundary.position, 'Native evidence reads exactly its captured snapshot, never later appends');
    assert(scan.maximumBufferedBytes <= 2 * Buffer.byteLength(event) + 2 * 64 * 1024, 'Buffered bytes depend only on one record and fixed chunks');
    assert(scan.maximumBufferedBytes < 300 * 1024);
    scope.diagnostic(JSON.stringify({ historyBytes: snapshot, ...scan }));
  }
});

test('unaccepted instructions remain pending and are never silently republished', async scope => {
  const native = fixture(scope); native.change({ accepted: false });
  await assert.rejects(applyNativeInstructions(native.session, native.options('Missing durable instruction')), /Uncertain/u);
  const retained = readFileSync(native.journal, 'utf8');
  native.signal.abort(new Error('Unavailable native instruction receipt'));
  await assert.rejects(applyNativeInstructions({ ...native.session }, native.options('Missing durable instruction')), /Unavailable/u);
  assert.equal(native.published().length, 1); assert.equal(readFileSync(native.journal, 'utf8'), retained);
});

test('wrong roles, changed bytes and retargeted private paths cannot certify native instructions', async scope => {
  for (const incorrect of [{ role: 'user' }, { text: 'Different native bytes' }]) {
    const native = fixture(scope); native.change(incorrect);
    await assert.rejects(applyNativeInstructions(native.session, native.options('Actual developer instructions')), /differs/u);
    assert.notEqual(readJson<{ pending: unknown }>(native.journal).pending, null);
    await assert.rejects(applyNativeInstructions({ ...native.session }, native.options('Actual developer instructions')), /differs/u);
    assert.equal(native.published().length, 1);
  }
  const native = fixture(scope); native.change({ loseReply: true });
  await assert.rejects(applyNativeInstructions(native.session, native.options('Retained native instructions')), /Uncertain/u);
  native.change({ path: join(native.home, 'sessions', 'another-native-history.jsonl'), loseReply: false });
  await assert.rejects(applyNativeInstructions(native.session, native.options('Retained native instructions')), /changed.*path/u);
  assert.equal(native.published().length, 1);
});

test('read-only native evidence preserves byte boundaries and rejects replaced/truncated or symlink histories', async scope => {
  const native = fixture(scope); native.header();
  const boundary = captureHistory(native.path); assert(boundary);
  const records: unknown[] = [];
  appendFileSync(native.path, '{"type":"unfinished"'); historySince(native.path, boundary, value => records.push(value)); assert.equal(records.length, 0);
  appendFileSync(native.path, '}\n'); historySince(native.path, boundary, value => records.push(value)); assert.deepEqual(records, [{ type: 'unfinished' }]);
  writeFileSync(native.path, '{"type":"replacement"}\n'); assert.throws(() => historySince(native.path, boundary, () => {}), /boundary/u);
  rmSync(native.path); symlinkSync(native.journal, native.path);
  await assert.rejects(applyNativeInstructions(native.session, native.options('Do not follow this path')), /ENOENT|ELOOP/u);
  assert.equal(native.published().length, 0);
  native.change({ path: join(native.workspace, 'outside.jsonl') });
  await assert.rejects(applyNativeInstructions(native.session, native.options('Reject external history')), /private managed history home/u);
});

test('installed native capability requires the actual experimental inject method and bounded array contract', () => {
  const supported = { definitions: { ThreadInjectItemsParams: { type: 'object', required: ['items', 'threadId'], properties: { items: { type: 'array' }, threadId: { type: 'string' } } } },
    oneOf: [{ properties: { method: { enum: ['thread/inject_items'] }, params: { $ref: '#/definitions/ThreadInjectItemsParams' } } }] };
  assert.equal(instructionCapability(supported).ok, true);
  for (const value of [null, {}, { ...supported, oneOf: [] }, { ...supported, definitions: {} },
    { ...supported, definitions: { ThreadInjectItemsParams: { required: [], properties: { items: { type: 'object' }, threadId: { type: 'string' } } } } }]) {
    const result = instructionCapability(value); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /Install.*thread\/inject_items/u);
  }
});

test('native create and resume retain configured defaults without ignored instruction settings or model turns', async scope => {
  const native = await fakeCodex(scope, { selection: { model: 'native-default-model', reasoningEffort: 'high' } });
  const input = { workspace: native.directory, endpoint: native.options.endpoint, token: native.options.token };
  for (const kind of ['create', 'resume'] as const) {
    const selection = kind === 'create' ? { kind, name: 'Managed native agent', config: {} } : { kind, id: THREAD, config: {} };
    const start = native.requests().length;
    const session = await openSession(input, selection, new AbortController().signal, native.options.hooks, () => {});
    cleanup(scope, session.close);
    const requests = native.requests().slice(start);
    assert.equal(session.sessionId, THREAD);
    const selected = requests.find(request => request.method === (kind === 'create' ? 'thread/start' : 'thread/resume'));
    assert.deepEqual(selected?.params, { cwd: native.directory, config: {}, ...(kind === 'create'
      ? { historyMode: 'paginated', ephemeral: false } : { threadId: THREAD, excludeTurns: true }) });
    assert.equal(requests.some(request => ['thread/inject_items', 'thread/settings/update'].includes(request.method ?? '') || request.method?.startsWith('turn/')), false);
    await session.close();
  }
});
