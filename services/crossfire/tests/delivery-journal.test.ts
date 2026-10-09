import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexDelivery } from '@ctlflow/crossfire-adapter-codex/connection';
import type { CodexSession } from '@ctlflow/crossfire-adapter-codex/session';
import { readDeliveryJournal, deliveryText } from '@ctlflow/crossfire-adapter-runtime/journal';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { canRecoverFailure } from '@ctlflow/crossfire-kernel/lifecycle';

test('malformed native delivery state is permanent and retained without replay or replacement', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'invalid-receipt-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'receipt.json'), sessionId = randomUUID(), messageId = randomUUID();
  const pending = check.object({ text: deliveryText, messageId: check.identifier });
  const receipt = { messageId, digest: 'a'.repeat(64) };
  for (const text of ['{', 'null', JSON.stringify({ sessionId: randomUUID(), pending: null, confirmed: [] }),
    JSON.stringify({ sessionId, pending: null, confirmed: [receipt, receipt] }),
    JSON.stringify({ sessionId, pending: { messageId, text: 'original' }, confirmed: [receipt] })]) {
    writeFileSync(file, text, { mode: 0o600 });
    assert.throws(() => readDeliveryJournal(file, sessionId, pending), error => {
      assert(error instanceof Error && 'code' in error); assert.equal(error.code, 'invalid');
      assert.equal(canRecoverFailure(error), false); return true;
    });
    assert.equal(readFileSync(file, 'utf8'), text);
  }
});

for (const published of [true, false]) test('lost native response preserves publication evidence across restart: ' + published, async scope => {
  const workspace = mkdtempSync(join(tmpdir(), 'receipt-proof-'));
  cleanup(scope, () => rmSync(workspace, { recursive: true, force: true }));
  const sessionId = randomUUID(), messageId = randomUUID(), turnId = randomUUID(), text = 'Exact input';
  const entries: unknown[] = [];
  let submissions = 0;
  const session: CodexSession = { sessionId, workspace, approval: 'none', signal: scope.signal, close: async () => {},
    request: async method => {
      if (method === 'thread/read') return { thread: { id: sessionId, cwd: workspace, canAcceptDirectInput: true, status: { type: 'idle' } } };
      if (method === 'thread/timeline/list') return { data: entries, nextCursor: null };
      assert.equal(method, 'turn/start'); submissions++;
      if (published) entries.push({ position: 1, type: 'item', turnId,
        item: { type: 'userMessage', id: 'receipt', clientId: messageId, content: [{ type: 'text', text }] } });
      throw new Error('Response disconnected after submission');
    } };
  const options = { receiptFile: join(workspace, 'receipt.json'), pollMs: 100, timeoutMs: 1000 };
  const first = codexDelivery(session, options);
  await assert.rejects(first.deliver(text, messageId), /Response disconnected/);
  assert.throws(() => codexDelivery(session, options), /already owns/);
  await first.close();
  let restarted = codexDelivery(session, options);
  cleanup(scope, () => restarted.close());
  if (published) {
    await restarted.deliver(text, messageId);
    await restarted.close();
    restarted = codexDelivery(session, options);
    await restarted.deliver(text, messageId);
    await assert.rejects(restarted.deliver('Changed content', messageId), /different content/);
    restarted.acknowledge([messageId]);
  } else {
    await assert.rejects(restarted.deliver(text, messageId), /publication is uncertain/);
    await assert.rejects(restarted.deliver(text, randomUUID()), /preceding native delivery/);
  }
  assert.equal(submissions, 1, 'Uncertain input is never replayed to the model');
});
