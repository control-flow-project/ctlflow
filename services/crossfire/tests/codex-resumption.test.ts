import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { codexDelivery } from '@ctlflow/crossfire-adapter-codex/connection';
import { codexInput } from '@ctlflow/crossfire-adapter-codex/input';
import type { CodexSession } from '@ctlflow/crossfire-adapter-codex/session';
import { readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';

for (const original of ['unknown', 'interrupted', 'completed', 'received', 'interrupted-restart'] as const) {
  test('restarted idle Codex continues the exact last request without interrupting a historical turn: ' + original, async scope => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-resumption-'));
    cleanup(scope, () => rmSync(directory, { recursive: true }));
    const sessionId = randomUUID(), messageId = randomUUID(), oldTurn = randomUUID(), file = join(directory, 'receipt.json');
    const text = 'Source: room !original:test; sender @human:test. Continue the portfolio analysis.';
    const entries: Record<string, unknown>[] = [{ position: 1, type: 'turnStarted', turnId: oldTurn }];
    if (original === 'received') entries.push({ position: 2, type: 'item', turnId: oldTurn,
      item: { type: 'userMessage', id: randomUUID(), clientId: messageId, content: [{ type: 'text', text }] } });
    if (original === 'completed' || original === 'interrupted') entries.push({ position: 2, type: 'turnCompleted', turnId: oldTurn, status: original });
    writeFileSync(file, JSON.stringify({ sessionId, pending: { turn: oldTurn, text, messageId, initializing: false, boundary: null }, confirmed: [] }), { mode: 0o600 });
    const publications: Record<string, unknown>[] = [], calls: string[] = [], observed: RuntimeObservationEvent[] = [];
    const session: CodexSession = { sessionId, workspace: directory, approval: 'none', signal: scope.signal, close: async () => {},
      request: async (method, params) => {
        calls.push(method);
        if (method === 'thread/read') return { thread: { id: sessionId, cwd: directory, canAcceptDirectInput: true, status: { type: 'idle' } } };
        if (method === 'thread/timeline/list') return { data: (params as { limit: number }).limit === 1 ? entries.slice(-1) : entries, nextCursor: null };
        if (method === 'turn/start') {
          const input = params as { clientUserMessageId: string; input: { text: string }[] };
          publications.push(input);
          const turn = randomUUID();
          entries.push({ position: entries.length + 1, type: 'turnStarted', turnId: turn });
          if (original === 'interrupted-restart' && publications.length === 1) {
            entries.push({ position: entries.length + 1, type: 'turnCompleted', turnId: turn, status: 'interrupted' });
          } else {
            entries.push({ position: entries.length + 1, type: 'item', turnId: turn,
              item: { type: 'userMessage', id: randomUUID(), clientId: input.clientUserMessageId, content: [{ type: 'text', text: input.input[0]!.text }] } });
          }
          return { turn: { id: turn } };
        }
        assert.fail('Unexpected native request: ' + method);
      } };
    const connection = codexDelivery(session, { receiptFile: file, pollMs: 100, timeoutMs: 1000, observe: event => observed.push(event) });
    cleanup(scope, () => connection.close());
    assert.equal(await connection.turnControl.activeTurn(), null);
    assert.equal(await connection.turnControl.interrupt(oldTurn), 'inactive');
    assert.equal(await connection.settle(), true);
    assert.equal(await connection.recover(text, messageId), true);
    assert.equal(publications.length, original === 'received' ? 0 : original === 'interrupted-restart' ? 2 : 1);
    const identifiers = publications.map(value => (value as { clientUserMessageId: string }).clientUserMessageId);
    assert.equal(new Set(identifiers).size, identifiers.length);
    assert(identifiers.every(identifier => identifier !== messageId));
    assert(!calls.includes('turn/interrupt')); assert(!calls.includes('thread/turns/list'));
    if (original !== 'received') {
      const submitted = publications[0] as { clientUserMessageId: string; input: { text: string }[] };
      assert.notEqual(submitted.clientUserMessageId, messageId);
      assert(submitted.input[0]!.text.includes('may or may not have been received'));
      assert(submitted.input[0]!.text.includes('Do not repeat completed actions'));
      const originals = readdirSync(join(directory, 'resume-input'));
      assert.equal(originals.length, 1); assert.equal(readFileSync(join(directory, 'resume-input', originals[0]!), 'utf8'), text);
      assert(observed.some(event => event.kind === 'output' && event.text.includes('new Codex turn')));
    }
    assert.equal(readDeliveryJournal(file, sessionId, codexInput).pending, null);
    connection.acknowledge([messageId]);
    assert.deepEqual(readDeliveryJournal(file, sessionId, codexInput).confirmed, []);
  });
}
