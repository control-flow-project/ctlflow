import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nativeDelivery } from '@ctlflow/crossfire-adapter-runtime/delivery';
import { deliveryText, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';

const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const input = check.object({ text: deliveryText, messageId: check.text(200), boundary: check.integer() });
const prepare = (text: string, messageId: string) => ({ text, messageId, boundary: 0 });
function temporary() { mkdirSync('.temp', { recursive: true }); return mkdtempSync(join(process.cwd(), '.temp/native-delivery-')); }

test('native evidence enrichment cannot replace an input and operations cannot compete with receipt recovery', async scope => {
  const file = join(temporary(), 'journal.json');
  let released!: () => void, prepared!: () => void;
  const publication = new Promise<void>(resolve => { prepared = resolve; }), barrier = new Promise<void>(resolve => { released = resolve; });
  const connection = nativeDelivery({ sessionId: session, approval: 'none', signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: async (original, retain) => {
      assert.throws(() => retain({ ...original, text: 'replacement' }), /original input/u);
      assert.throws(() => retain({ ...original, messageId: 'another' }), /original input/u);
      retain({ ...original, boundary: 43 }); prepared(); await barrier;
    }, received: retained => { assert.equal(retained.boundary, 43); return true; }, close: () => {} }, input, { journal: file, pollMs: 100 });
  cleanup(scope, () => { released(); return connection.close(); });
  const delivery = connection.deliver('Original text.', 'exact-id'); await publication;
  assert.equal(connection.unsettled(), true);
  await assert.rejects(connection.recover('Original text.', 'exact-id'), /sequential/u);
  await assert.rejects(connection.deliver('Competing.', 'different-id'), /sequential/u);
  await assert.rejects(connection.settle(), /sequential/u);
  released(); await delivery;
  assert.equal(connection.unsettled(), true, 'Confirmed but unacknowledged input vetoes sleep');
  connection.acknowledge(['exact-id']); assert.equal(connection.unsettled(), false);
});

test('receipt-only interrupted recovery never publishes, but explicit retry uses one new native input', async scope => {
  const file = join(temporary(), 'journal.json'); let published = 0, receipt: true | 'interrupted' = 'interrupted';
  const connection = nativeDelivery({ sessionId: session, approval: 'none', signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { if (++published === 1) throw new Error('Response lost'); }, received: () => receipt, close: () => {} }, input, { journal: file, pollMs: 100 });
  cleanup(scope, () => connection.close());
  await assert.rejects(connection.deliver('Original.', 'exact'), /Response lost/u);
  assert.equal(await connection.recover('Original.', 'exact'), false); assert.equal(published, 1);
  assert.equal(connection.unsettled(), false); receipt = true;
  await connection.deliver('Original.', 'exact'); assert.equal(published, 2);
});

test('unproved cancellation preserves uncertainty and aborting a native connection cannot discard its journal', async scope => {
  for (const abortNative of [false, true]) {
    const file = join(temporary(), 'journal.json'), native = new AbortController(), cancelled = new AbortController();
    let cancellations = 0;
    const connection = nativeDelivery({ sessionId: session, approval: 'none', signal: native.signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
      publish: () => { (abortNative ? native : cancelled).abort(new Error('Stopped')); }, received: () => false,
      cancel: () => { cancellations++; return false; }, close: () => {} }, input, { journal: file, pollMs: 100 });
    cleanup(scope, () => connection.close());
    await assert.rejects(connection.deliver('Retain uncertain.', 'pending', cancelled.signal), /Stopped/u);
    assert.equal(cancellations, abortNative ? 0 : 1); assert.equal(connection.unsettled(), true);
    assert.equal(readDeliveryJournal(file, session, input).pending?.messageId, 'pending');
  }
});

test('read-only canonical journals reject conflicting evidence, wrong sessions and dangling symlinks without writing', () => {
  const directory = temporary(), file = join(directory, 'journal.json');
  assert.deepEqual(readDeliveryJournal(file, session, input), { sessionId: session, pending: null, confirmed: [] });
  assert.deepEqual(readdirSync(directory), []);
  const confirmed = { messageId: 'pending', digest: 'a'.repeat(64) };
  for (const state of [{ sessionId: 'other', pending: null, confirmed: [] },
    { sessionId: session, pending: prepare('text', 'pending'), confirmed: [confirmed] },
    { sessionId: session, pending: null, confirmed: [confirmed, confirmed] },
    { sessionId: session, pending: null, confirmed: [], legacy: true }]) {
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 }); assert.throws(() => readDeliveryJournal(file, session, input), /journal|receipt|pending/u);
  }
  const link = join(directory, 'dangling'); symlinkSync(join(directory, 'absent'), link);
  assert.throws(() => readDeliveryJournal(link, session, input));
  assert.deepEqual(readdirSync(directory).sort(), ['dangling', 'journal.json']);
});

test('native publication is journaled before send and uncertain recovery never replays input', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json');
  let published = 0, received = false, time = 0;
  const native = { sessionId: session, approval: 'none' as const, signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare: (text: string, messageId: string) => ({ text, messageId, boundary: 42 }),
    publish: () => { assert.equal(readJson<{ pending: { messageId: string } }>(file).pending.messageId, 'input'); published++; throw new Error('Lost native response'); },
    received: () => received, wait: async (milliseconds: number) => { time += milliseconds; }, close: () => {} };
  const first = nativeDelivery(native, input, { journal: file, pollMs: 100, timeoutMs: 100 });
  await assert.rejects(first.deliver('Exact text.', 'input'), /Lost native response/);
  assert.throws(() => nativeDelivery(native, input, { journal: file, pollMs: 100 }), /already owns/);
  await first.close();
  const restored = nativeDelivery(native, input, { journal: file, pollMs: 100, timeoutMs: 100, now: () => time });
  cleanup(scope, () => restored.close());
  await assert.rejects(restored.deliver('Exact text.', 'input'), /uncertain/);
  assert.equal(published, 1);
  received = true;
  await restored.deliver('Exact text.', 'input');
  await restored.deliver('Exact text.', 'input');
  assert.equal(published, 1);
  await assert.rejects(restored.deliver('Different text.', 'input'), /different content/);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 1);
  restored.acknowledge(['input']);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 0);
});

test('cancellation can clear only a proved unpublished native input', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json');
  const cancel = new AbortController();
  let cancelled = 0;
  const connection = nativeDelivery({ sessionId: session, approval: 'none', signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { cancel.abort(new Error('Owner control')); }, received: () => false,
    cancel: () => { cancelled++; return true; }, close: () => {} }, input, { journal: file, pollMs: 100 });
  cleanup(scope, () => connection.close());
  await assert.rejects(connection.deliver('Queued input.', 'cancelled', cancel.signal), /Owner control/);
  assert.equal(cancelled, 1);
  assert.equal(readJson<{ pending: unknown }>(file).pending, null);
  assert.equal(await connection.settle(), false);
});

test('positive native waiting preserves busy input without a turn-duration deadline or early receipt', async scope => {
  const file = join(temporary(), 'journal.json');
  let published = 0, polls = 0, time = 0;
  const connection = nativeDelivery({ sessionId: session, approval: 'none', signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { published++; }, received: () => {
      polls++;
      if (polls <= 3) {
        assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 0);
        return 'waiting';
      }
      return true;
    }, wait: async milliseconds => { time += milliseconds; }, close: () => {} }, input, { journal: file, pollMs: 100, timeoutMs: 100, now: () => time });
  cleanup(scope, () => connection.close());
  await connection.deliver('Queued behind native work.', 'busy');
  assert.equal(time, 300);
  assert.equal(published, 1);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 1);
});

test('native cancellation receipts never claim successful delivery on send or recovery', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json');
  let published = 0, uncertain = true;
  const native = { sessionId: session, approval: 'none' as const, signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { published++; if (uncertain) throw new Error('Lost response'); },
    received: () => 'cancelled' as const, close: () => {} };
  const connection = nativeDelivery(native, input, { journal: file, pollMs: 100 });
  cleanup(scope, () => connection.close());
  await assert.rejects(connection.deliver('Exact input.', 'first'), /Lost response/);
  await assert.rejects(connection.deliver('Exact input.', 'first'), /cancelled before publication/);
  assert.equal(published, 1);
  uncertain = false;
  await assert.rejects(connection.deliver('Exact input.', 'second'), /cancelled before publication/);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 0);
});

test('invalid journal identity, text and limits are refused before publication', async scope => {
  const directory = temporary(); let published = 0;
  const native = { sessionId: session, approval: 'none' as const, signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { published++; }, received: () => true, close: () => {} };
  assert.throws(() => nativeDelivery(native, input, { journal: join(directory, 'a'), pollMs: 1 }), /interval/);
  const connection = nativeDelivery(native, input, { journal: join(directory, 'a'), pollMs: 100 });
  cleanup(scope, () => connection.close());
  await assert.rejects(connection.deliver('x'.repeat(4 * 1024 * 1024 + 1), 'oversized'), /byte bound/);
  await assert.rejects(connection.deliver('text', ''), /text/);
  assert.equal(published, 0);
});

test('receipt-only recovery confirms, cancels or refuses uncertainty without publishing new input', async scope => {
  const file = join(temporary(), 'journal.json'); let publications = 0, receipt: boolean | 'cancelled' = false, time = 0;
  const native = { sessionId: session, approval: 'none' as const, signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => { publications++; throw new Error('Lost publication response'); }, received: () => receipt,
    wait: async (milliseconds: number) => { time += milliseconds; }, close: () => {} };
  const connection = nativeDelivery(native, input, { journal: file, pollMs: 100, timeoutMs: 100, now: () => time });
  cleanup(scope, () => connection.close());
  assert.equal(await connection.recover('Never submitted.', 'absent'), false);
  await assert.rejects(connection.deliver('Exact input.', 'pending'), /Lost publication response/);
  await assert.rejects(connection.recover('Different input.', 'pending'), /does not match/);
  await assert.rejects(connection.recover('Exact input.', 'pending'), /uncertain/);
  assert.equal(publications, 1);
  receipt = true; assert.equal(await connection.recover('Exact input.', 'pending'), true);
  assert.equal(await connection.recover('Exact input.', 'pending'), true);
  connection.acknowledge(['pending']); assert.equal(await connection.recover('Exact input.', 'pending'), false);
  await assert.rejects(connection.deliver('Cancelled input.', 'cancelled'), /Lost publication response/);
  receipt = 'cancelled'; assert.equal(await connection.recover('Cancelled input.', 'cancelled'), false);
  assert.equal(publications, 2);
});

test('native session identities are opaque, bounded and exactly bound to their journal', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json'), opaque = 'native-session:not-a-crossfire-uuid';
  const native = { sessionId: opaque, approval: 'none' as const, signal: new AbortController().signal, verify: () => {}, inspect: async () => ({ busy: false }), prepare,
    publish: () => {}, received: () => true, close: () => {} };
  const connection = nativeDelivery(native, input, { journal: file, pollMs: 100 });
  cleanup(scope, () => connection.close());
  await connection.deliver('Native identity belongs to the adapter.', 'input');
  assert.equal(readJson<{ sessionId: string }>(file).sessionId, opaque);
  await connection.close();
  assert.throws(() => nativeDelivery({ ...native, sessionId: 'another-native-session' }, input, { journal: file, pollMs: 100 }), /session binding/);
  for (const [index, sessionId] of ['', 'x'.repeat(201), 'native\ncontrol'].entries()) {
    assert.throws(() => nativeDelivery({ ...native, sessionId }, input, { journal: join(directory, 'invalid-' + index), pollMs: 100 }), /session binding/);
  }
});
