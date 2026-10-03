import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { connectCodex } from '@crossfire/adapter-codex/connection';
import { nativeProvider } from '../scripts/test-support/native-provider.js';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { until } from '../scripts/test-support/listener.js';

test('exact authenticated WS attachment leaves the external engine and sessions alive on receiver shutdown', { timeout: 30_000 }, async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/native-attachment-'));
  const home = join(directory, 'home'), workspace = join(directory, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  const provider = await nativeProvider(scope, home);
  const engine = await nativeEngine(scope, home, workspace);
  await assert.rejects(connectCodex({ ...engine, hooks: { requestDecision: async () => { throw new Error('Unexpected permission'); } } },
    new AbortController().signal), /no rollout found|not found/);
  assert.equal(provider.requests.length, 0, 'Attachment cannot insert a synthetic first model turn');
  await materialize(engine, provider);
  const other = await engine.call('thread/start', { cwd: workspace });
  const stop = new AbortController();
  const options = { ...engine, timeoutMs: 10_000, pollMs: 100,
    hooks: { requestDecision: async () => { throw new Error('Unexpected permission in inert attachment proof'); } } };
  await assert.rejects(connectCodex({ ...options, token: 'incorrect-token' }, stop.signal), /connection failed/);
  const attached = await connectCodex(options, stop.signal);
  cleanup(scope, attached.close);
  await attached.deliver('Exact existing-session input', 'native-attachment-receipt');
  await until(() => provider.held() !== undefined);
  provider.finish();
  await until(() => engine.notifications.some(notice => notice.method === 'turn/completed'));
  stop.abort(new Error('End this receiver only'));
  await attached.close();
  assert.equal(engine.child.exitCode, null);
  for (const session of [engine.session, (other.thread as { id: string }).id]) {
    const read = await engine.call('thread/read', { threadId: session, includeTurns: false });
    assert.equal((read.thread as { id: string }).id, session);
  }
  const history = await engine.call('thread/timeline/list', { threadId: engine.session, limit: 10 });
  assert(JSON.stringify(history).includes('native-attachment-receipt'));
  const reattached = await connectCodex(options, new AbortController().signal);
  cleanup(scope, reattached.close);
  engine.child.kill('SIGTERM');
  await engine.ended;
  await until(() => reattached.signal.aborted);
});
