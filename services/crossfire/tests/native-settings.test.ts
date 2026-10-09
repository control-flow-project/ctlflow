import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { resumeFixture } from '../scripts/test-support/codex-runtime.js';

test('external app-server owns model, reasoning and workspace settings', async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/native-options-'));
  const home = join(directory, 'home'), workspace = join(directory, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  const provider = await nativeProvider(scope, home);
  const engine = await nativeEngine(scope, home, workspace, ['-c', 'model="fixture-selected"', '-c', 'model_reasoning_effort="high"']);
  await materialize(engine, provider);
  const attached = await resumeFixture({ ...engine, hooks: { requestDecision: async () => { throw new Error('Unexpected permission'); } } }, new AbortController().signal);
  cleanup(scope, attached.close);
  assert.equal(engine.thread.cwd, workspace);
  assert.equal(engine.thread.model, 'fixture-selected');
  assert.equal(engine.thread.reasoningEffort, 'high');
  assert.deepEqual(provider.requests, []);
});
