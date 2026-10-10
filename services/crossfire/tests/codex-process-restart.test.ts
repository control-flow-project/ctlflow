import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { codexDelivery, type CodexConnection } from '@ctlflow/crossfire-adapter-codex/connection';
import { openSession } from '@ctlflow/crossfire-adapter-codex/session';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { until } from '../scripts/test-support/listener.js';

test('actual Codex process death continues an unrecorded queued message in a new turn of the same saved history', { timeout: 60_000 }, async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/codex-process-restart-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const home = join(directory, 'home'), workspace = join(directory, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  const provider = await nativeProvider(scope, home), original = await nativeEngine(scope, home, workspace);
  await materialize(original, provider);
  await original.call('turn/start', { threadId: original.session, input: [{ type: 'text', text: 'Earlier live work', text_elements: [] }] });
  await until(() => provider.held() !== undefined);
  const text = 'Source: room !same:test; sender @requester:test. Continue the requested analysis.', messageId = 'original-queued-request';
  const queued = await original.call('turn/start', { threadId: original.session, clientUserMessageId: messageId,
    input: [{ type: 'text', text, text_elements: [] }] });
  const turnId = (queued.turn as { id: string }).id;
  const before = await original.call('thread/timeline/list', { threadId: original.session, limit: 100 });
  assert((before.data as { type: string; turnId: string }[]).some(entry => entry.type === 'turnStarted' && entry.turnId === turnId));
  assert(!(before.data as { item?: { clientId?: string } }[]).some(entry => entry.item?.clientId === messageId));
  writeFileSync(original.receiptFile, JSON.stringify({ sessionId: original.session,
    pending: { text, messageId, turn: turnId, boundary: null, initializing: false }, confirmed: [] }), { mode: 0o600 });
  process.kill(-original.child.pid!, 'SIGKILL'); await original.ended;
  const restarted = await nativeEngine(scope, home, workspace), methods: string[] = [];
  let connection: CodexConnection | undefined;
  const session = await openSession(restarted, { kind: 'resume', id: original.session, config: {} }, scope.signal,
    { requestDecision: async () => assert.fail('Restart must not invent a decision') }, event => connection?.event(event));
  connection = codexDelivery({ ...session, request: async (method, params, signal) => { methods.push(method); return session.request(method, params, signal); } },
    { receiptFile: original.receiptFile, pollMs: 100, timeoutMs: 10_000 });
  const current = connection; cleanup(scope, () => current.close());
  assert.equal(await current.turnControl.activeTurn(), null);
  assert.equal(await current.turnControl.interrupt(turnId), 'inactive');
  assert.equal(await current.settle(), true);
  assert.equal(await current.recover(text, messageId), true);
  assert.equal(current.sessionId, original.session);
  assert.equal(methods.filter(method => method === 'turn/start').length, 1);
  assert(!methods.includes('turn/interrupt'));
  await until(() => provider.requests.some(request => JSON.stringify(request).includes('[Crossfire session restarted]')));
  const retained = readdirSync(join(home, 'resume-input'));
  assert.equal(retained.length, 1); assert.equal(readFileSync(join(home, 'resume-input', retained[0]!), 'utf8'), text);
  current.acknowledge([messageId]);
});
