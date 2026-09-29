import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { codexRuntime } from '@crossfire/adapter-codex/owned';
import { nativeProvider } from '../scripts/test-support/native-provider.js';
import { until } from '../scripts/test-support/listener.js';
import { value } from './support/application.js';

test('owned stock Codex has zero-model startup and resumes the same private native session', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/owned-codex-'));
  const workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home), adapter = codexRuntime(), stop = new AbortController();
  const input = { name: 'native-proof', workspace, instructions: 'Inert native verification. Never contact external services.',
    options: { model: 'gpt-5.2', model_reasoning_effort: 'high', sandbox_mode: 'read-only', approval_policy: 'never' },
    hooks: { requestPermission: async () => { throw new Error('No approvals are expected'); } } };
  let runtime = value(await adapter.start(input, stop.signal));
  scope.after(() => runtime.close());
  assert.equal(provider.requests.length, 0);
  const sessionId = runtime.sessionId;
  await runtime.close();
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  assert.equal(provider.requests.length, 0);
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  await until(() => provider.requests.length === 1);
  const request = provider.requests[0] as { model: string; reasoning: { effort: string } };
  assert.equal(request.model, 'gpt-5.2'); assert.equal(request.reasoning.effort, 'high', JSON.stringify(request.reasoning));
  provider.finish();
  while (await runtime.activeTurn() !== null) await delay(50);
  await runtime.close();
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  assert.equal(provider.requests.length, 1, 'Exact receipt prevents replay across engine restart');
});
