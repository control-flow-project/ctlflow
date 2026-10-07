import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createResumeWork } from '@ctlflow/fleetd-storage/resume-work';
import { continuationText, resumeInterruptedWork, type ResumeWorkStore } from '@ctlflow/fleetd-domain/resume-work';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
function fixture(scope: Parameters<typeof cleanup>[0]) {
  const state = mkdtempSync(join(tmpdir(), 'fleetd-resume-work-'));
  cleanup(scope, () => rmSync(state, { recursive: true, force: true }));
  return { state, file: join(state, 'resume-work.json'), store: createResumeWork(state, () => 1000) };
}
function connection(sessionId: string, receipts: Set<string>, delivered: { sessionId: string; messageId: string; text: string }[]): RuntimeConnection & Pick<OwnedRuntimeConnection, 'turnControl'> {
  return { sessionId, signal: new AbortController().signal, approval: 'listener',
    deliver: async (text, messageId) => { receipts.add(messageId); delivered.push({ sessionId, messageId, text }); },
    recover: async (_text, messageId) => receipts.has(messageId), acknowledge: ids => { for (const id of ids) receipts.delete(id); },
    settle: async () => false, inspect: async () => ({ busy: false }), close: async () => {},
    turnControl: { activeTurn: async () => null, interrupt: async () => {} } };
}

test('every continuation asks for current AGENTS.md instructions before resuming unfinished work', () => {
  for (const context of ['shared', 'control', '!room:test']) {
    const text = continuationText({ context, sessionId: randomUUID(), messageId: randomUUID(), checkpointedAt: 1000 });
    const reminder = 'Before continuing, re-read the applicable AGENTS.md files and follow their current instructions.';
    assert(text.includes(reminder));
    assert(text.indexOf(reminder) < text.indexOf('resume that task'));
  }
});

test('interrupted work is private, bounded, exact-history keyed and durable without repeated activity writes', scope => {
  const { state, file, store } = fixture(scope), context = { context: 'shared', sessionId: randomUUID() };
  assert.deepEqual(value(store.read()), []); value(store.capture([context]));
  const first = readFileSync(file), modified = statSync(file, { bigint: true }).mtimeNs;
  value(store.capture([context])); assert.deepEqual(readFileSync(file), first); assert.equal(statSync(file, { bigint: true }).mtimeNs, modified);
  assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(state).mode & 0o777, 0o700);
  const restored = createResumeWork(state); assert.deepEqual(value(restored.read()), value(store.read()));
  assert.equal(store.capture([{ ...context, sessionId: randomUUID() }]).ok, false);
  value(restored.acknowledge(value(store.read())[0]!.messageId)); assert.deepEqual(value(store.read()), []);
  value(store.capture([context])); assert.notDeepEqual(readFileSync(file), first, 'A later interrupted task has another native receipt');
});

test('malformed, shared, oversized and dangling-symlink work checkpoints fail closed', scope => {
  const { file, store } = fixture(scope);
  for (const content of ['not json', '[{"context":"shared"}]', ' '.repeat(2 * 1024 * 1024 + 1)]) {
    writeFileSync(file, content, { mode: 0o600 }); assert.equal(store.read().ok, false); assert.equal(store.capture([]).ok, false);
  }
  writeFileSync(file, '[]'); chmodSync(file, 0o644); assert.equal(store.read().ok, false);
  unlinkSync(file); symlinkSync(file + '.missing', file); assert.equal(store.read().ok, false);
});

test('room continuations retain attribution, never approve decisions and touch only their exact saved native histories', async scope => {
  const { store } = fixture(scope), receipts = new Set<string>(), delivered: { sessionId: string; messageId: string; text: string }[] = [];
  const contexts: SavedRuntimeContext[] = ['control', '!room-a:test', '!room-b:test'].map(context => ({ context, sessionId: randomUUID(), runtime: 'fixture', workspace: '/fixture' }));
  const targets = new Map(contexts.map(context => [context.context, connection(context.sessionId, receipts, delivered)]));
  const primary = targets.get('control')!;
  const owned: OwnedRuntimeConnection = { ...primary, attachment: { runtime: 'fixture', sessionId: primary.sessionId, workspace: '/fixture', connection: {} },
    attachments: async () => [], conversation: async context => targets.get(context) ?? assert.fail('Cannot create a new history') };
  value(store.capture(contexts.slice(1).map(({ context, sessionId }) => ({ context, sessionId })))); await resumeInterruptedWork(owned, 'control', contexts, store);
  assert.deepEqual(delivered.map(item => item.sessionId), contexts.slice(1).map(item => item.sessionId));
  assert(delivered.every(item => item.text.includes('re-read the applicable AGENTS.md files')));
  assert(delivered.every(item => item.text.includes('not a new assignment') && item.text.includes('No pending question or permission has been answered or approved')));
  assert(delivered[0]!.text.includes('!room-a:test') && !delivered[0]!.text.includes('!room-b:test'));
  assert.equal(receipts.size, 0); assert.deepEqual(value(store.read()), []);
  await resumeInterruptedWork(owned, 'control', contexts, store); assert.equal(delivered.length, 2);
});

test('ambiguous post-delivery storage failure recovers the same receipt without a duplicate continuation', async scope => {
  const { store } = fixture(scope), sessionId = randomUUID(), receipts = new Set<string>(), delivered: { sessionId: string; messageId: string; text: string }[] = [];
  const primary = connection(sessionId, receipts, delivered), contexts = [{ context: 'shared', sessionId, runtime: 'fixture', workspace: '/fixture' }];
  const owned: OwnedRuntimeConnection = { ...primary, attachment: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: {} }, attachments: async () => [] };
  value(store.capture(contexts.map(({ context, sessionId }) => ({ context, sessionId }))));
  const failing: ResumeWorkStore = { ...store, acknowledge: () => failure('unavailable', 'Controlled atomic checkpoint failure') };
  await assert.rejects(resumeInterruptedWork(owned, 'shared', contexts, failing), /Controlled atomic checkpoint failure/);
  assert.equal(delivered.length, 1); assert.equal(receipts.size, 1); assert.equal(value(store.read()).length, 1);
  assert(delivered[0]!.text.includes('re-read the applicable AGENTS.md files'));
  await resumeInterruptedWork(owned, 'shared', contexts, store);
  assert.equal(delivered.length, 1); assert.equal(receipts.size, 0); assert.deepEqual(value(store.read()), []);
});

test('all saved context identities are validated before any continuation or conversation creation', async scope => {
  const { store } = fixture(scope), sessionId = randomUUID(), delivered: { sessionId: string; messageId: string; text: string }[] = [];
  const primary = connection(sessionId, new Set(), delivered);
  const owned: OwnedRuntimeConnection = { ...primary, attachment: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: {} },
    attachments: async () => [], conversation: async () => assert.fail('No new history may be created') };
  value(store.capture([{ context: 'shared', sessionId }, { context: '!missing:test', sessionId: randomUUID() }]));
  await assert.rejects(resumeInterruptedWork(owned, 'shared', [{ context: 'shared', sessionId, runtime: 'fixture', workspace: '/fixture' }], store), /different native history/);
  assert.equal(delivered.length, 0); assert.equal(value(store.read()).length, 2);
  assert(continuationText(value(store.read())[0]!).includes('Do not infer a destination room'));
});
