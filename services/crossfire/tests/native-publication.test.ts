import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { nativeDelivery } from '@crossfire/adapter-runtime/delivery';
import { captureHistory, historySince, nativeJson } from '@crossfire/adapter-runtime/native-file';
import * as check from '@crossfire/contracts/schema/validation';
import { readJson } from '@crossfire/adapter-filesystem/index';

const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function temporary() { mkdirSync('.temp', { recursive: true }); return mkdtempSync(join(process.cwd(), '.temp/native-delivery-')); }

test('native publication is journaled before send and uncertain recovery never replays input', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json');
  let published = 0, received = false;
  const native = { sessionId: session, signal: new AbortController().signal, verify: () => {}, boundary: () => 42,
    publish: () => { assert.equal(readJson<{ pending: { messageId: string } }>(file).pending.messageId, 'input'); published++; throw new Error('Lost native response'); },
    received: () => received, close: () => {} };
  const first = nativeDelivery(native, check.integer(), { journal: file, pollMs: 100, timeoutMs: 100 });
  await assert.rejects(first.deliver('Exact text.', 'input'), /Lost native response/);
  assert.throws(() => nativeDelivery(native, check.integer(), { journal: file, pollMs: 100 }), /already owns/);
  await first.close();
  const restored = nativeDelivery(native, check.integer(), { journal: file, pollMs: 100, timeoutMs: 100 });
  scope.after(() => restored.close());
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
  const connection = nativeDelivery({ sessionId: session, signal: new AbortController().signal, verify: () => {}, boundary: () => 0,
    publish: () => { cancel.abort(new Error('Owner control')); }, received: () => false,
    cancel: () => { cancelled++; return true; }, close: () => {} }, check.integer(), { journal: file, pollMs: 100 });
  scope.after(() => connection.close());
  await assert.rejects(connection.deliver('Queued input.', 'cancelled', cancel.signal), /Owner control/);
  assert.equal(cancelled, 1);
  assert.equal(readJson<{ pending: unknown }>(file).pending, null);
  assert.equal(await connection.settle(), false);
});

test('positive native waiting preserves busy input without a turn-duration deadline or early receipt', async scope => {
  const file = join(temporary(), 'journal.json');
  let published = 0, polls = 0;
  const connection = nativeDelivery({ sessionId: session, signal: new AbortController().signal, verify: () => {}, boundary: () => 0,
    publish: () => { published++; }, received: () => {
      polls++;
      if (polls <= 3) {
        assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 0);
        return 'waiting';
      }
      return true;
    }, close: () => {} }, check.integer(), { journal: file, pollMs: 100, timeoutMs: 100 });
  scope.after(() => connection.close());
  const started = performance.now();
  await connection.deliver('Queued behind native work.', 'busy');
  assert(performance.now() - started >= 250);
  assert.equal(published, 1);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 1);
});

test('native cancellation receipts never claim successful delivery on send or recovery', async scope => {
  const directory = temporary(), file = join(directory, 'journal.json');
  let published = 0, uncertain = true;
  const native = { sessionId: session, signal: new AbortController().signal, verify: () => {}, boundary: () => 0,
    publish: () => { published++; if (uncertain) throw new Error('Lost response'); },
    received: () => 'cancelled' as const, close: () => {} };
  const connection = nativeDelivery(native, check.integer(), { journal: file, pollMs: 100 });
  scope.after(() => connection.close());
  await assert.rejects(connection.deliver('Exact input.', 'first'), /Lost response/);
  await assert.rejects(connection.deliver('Exact input.', 'first'), /cancelled before publication/);
  assert.equal(published, 1);
  uncertain = false;
  await assert.rejects(connection.deliver('Exact input.', 'second'), /cancelled before publication/);
  assert.equal(readJson<{ confirmed: unknown[] }>(file).confirmed.length, 0);
});

test('native history verification excludes old inputs, partial records and replaced/truncated files', () => {
  const directory = temporary(), file = join(directory, 'native.jsonl');
  writeFileSync(file, '{"id":"old"}\n');
  const boundary = captureHistory(file);
  appendFileSync(file, '{"id":"new"}\n{"id":');
  assert.deepEqual(historySince(file, boundary), [{ id: 'new' }]);
  appendFileSync(file, '"pending"}\n');
  assert.deepEqual(historySince(file, boundary), [{ id: 'new' }, { id: 'pending' }]);
  appendFileSync(file, '{"id":"incomplete');
  const partial = captureHistory(file);
  assert.deepEqual(historySince(file, partial), []);
  appendFileSync(file, '"}\n{"id":"complete"}\n');
  assert.deepEqual(historySince(file, partial), [{ id: 'incomplete' }, { id: 'complete' }]);
  renameSync(file, file + '.old'); writeFileSync(file, '{"id":"old"}\n');
  assert.throws(() => historySince(file, boundary), /lost its publication boundary/);
  const replaced = captureHistory(file);
  writeFileSync(file, ''); assert.throws(() => historySince(file, replaced), /lost its publication boundary/);
  symlinkSync(file, join(directory, 'link'));
  assert.throws(() => nativeJson(join(directory, 'link')));
});

test('invalid journal identity, text and limits are refused before publication', async scope => {
  const directory = temporary(); let published = 0;
  const native = { sessionId: session, signal: new AbortController().signal, verify: () => {}, boundary: () => 0,
    publish: () => { published++; }, received: () => true, close: () => {} };
  assert.throws(() => nativeDelivery(native, check.integer(), { journal: join(directory, 'a'), pollMs: 1 }), /interval/);
  const connection = nativeDelivery(native, check.integer(), { journal: join(directory, 'a'), pollMs: 100 });
  scope.after(() => connection.close());
  await assert.rejects(connection.deliver('x'.repeat(98305), 'oversized'), /byte bound/);
  await assert.rejects(connection.deliver('text', ''), /text/);
  assert.equal(published, 0);
});
