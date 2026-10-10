import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { codexDelivery } from '@ctlflow/crossfire-adapter-codex/connection';
import { codexInput } from '@ctlflow/crossfire-adapter-codex/input';
import { readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import type { CodexSession } from '@ctlflow/crossfire-adapter-codex/session';

for (const recorded of [true, false]) for (const missing of [false, true]) test('lost restart response retains exact context: recorded=' + recorded + ', missing file=' + missing, async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-resumption-retry-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const sessionId = randomUUID(), messageId = randomUUID(), file = join(directory, 'receipt.json');
  const text = 'Origin room !original:test and sender @human:test. ' + 'large message '.repeat(10000);
  writeFileSync(file, JSON.stringify({ sessionId, pending: { turn: null, text, messageId, initializing: false, boundary: null }, confirmed: [] }), { mode: 0o600 });
  const entries: Record<string, unknown>[] = [], submissions: { clientUserMessageId: string; input: { text: string }[] }[] = [];
  const session: CodexSession = { sessionId, workspace: directory, approval: 'none', signal: scope.signal, close: async () => {},
    request: async (method, params) => {
      if (method === 'thread/read') return { thread: { id: sessionId, cwd: directory, canAcceptDirectInput: true, status: { type: 'idle' } } };
      if (method === 'thread/timeline/list') return { data: (params as { limit: number }).limit === 1 ? entries.slice(-1) : entries, nextCursor: null };
      assert.equal(method, 'turn/start');
      const input = params as { clientUserMessageId: string; input: { text: string }[] }; submissions.push(input);
      const turn = randomUUID();
      if (recorded || submissions.length > 1) entries.push({ position: entries.length + 1, type: 'item', turnId: turn,
        item: { type: 'userMessage', id: randomUUID(), clientId: input.clientUserMessageId, content: [{ type: 'text', text: input.input[0]!.text }] } });
      if (submissions.length === 1) throw new Error('Controlled loss after restart submission');
      return { turn: { id: turn } };
    } };
  const options = { receiptFile: file, pollMs: 100, timeoutMs: 1000 };
  const first = codexDelivery(session, options);
  await assert.rejects(first.settle(), /Controlled loss after restart submission/);
  await first.close();
  const pending = readDeliveryJournal(file, sessionId, codexInput).pending!;
  assert.equal(pending.text, text); assert.equal(pending.messageId, messageId);
  assert.equal(pending.resumption!.messageId, submissions[0]!.clientUserMessageId);
  assert.equal(pending.resumption!.turn, null);
  assert(Buffer.byteLength(pending.resumption!.text) < 2048, 'Large message remains in a file, not copied into the restart turn');
  const originalFile = join(directory, 'resume-input', readdirSync(join(directory, 'resume-input'))[0]!);
  if (missing) rmSync(originalFile);
  const second = codexDelivery(session, options); cleanup(scope, () => second.close());
  assert.equal(await second.settle(), true); assert.equal(await second.recover(text, messageId), true);
  assert.equal(submissions.length, recorded ? 1 : 2);
  if (!recorded) assert.notEqual(submissions[0]!.clientUserMessageId, submissions[1]!.clientUserMessageId);
  assert.equal(readFileSync(originalFile, 'utf8'), text, 'Exact attributed context exists before the original journal is cleared');
  assert.equal(readFileSync(file, 'utf8').includes('resumption'), false);
});
