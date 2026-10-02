import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { trustWorkspace } from '@crossfire/test-support/codex';

test('private Codex fixture trust preserves provider configuration and targets only its exact workspace', () => {
  mkdirSync('.temp', { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/codex-config-'));
  const file = join(directory, 'config.toml'), original = 'model = "fixture"\napproval_policy = "never"\n';
  const workspace = join(directory, 'workspace"literal');
  writeFileSync(file, original, { mode: 0o600 });
  trustWorkspace(directory, workspace);
  assert.equal(readFileSync(file, 'utf8'), original + '\n[projects.' + JSON.stringify(workspace) + ']\ntrust_level = "trusted"\n');
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
