import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexDelivery } from '@crossfire/adapter-codex/connection';
import type { CodexSession } from '@crossfire/adapter-codex/session';

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
