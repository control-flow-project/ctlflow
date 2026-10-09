import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { value } from '@ctlflow/crossfire-test-support/result';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { contextState } from '@ctlflow/crossfire-adapter-codex/context-state';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { migrateControllerContexts } from '../apps/daemon/src/context-migration.js';

test('explicit controller conversion locks every registered receiver before converting and retains stopped intent', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-context-migration-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const root = privateDir(join(directory, 'controller')), fleet = privateDir(join(directory, 'fleet'));
  const definition = privateDir(join(fleet, 'agents/worker'));
  writeFileSync(join(definition, 'agent.toml'), 'name = "Worker"\nruntime = "codex"\n[runtime_options]\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Use explicit room tools.', { mode: 0o600 });
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "team"\n[coordination]\nadapter = "crossfire"\nserver = "https://example.test"\nowner = "@owner:test"\n'
    + ['first', 'second'].map(key => '\n[[instances]]\nkey = "' + key + '"\nname = "' + key
      + '"\ndefinition = "worker"\nworkarea = "agents/worker/workarea/' + key + '"\n').join(''), { mode: 0o600 });
  const registry = createRegistry(root), configuration = value(registry.load(fleet)), fleetId = randomUUID();
  value(registry.saveRegistrations([{ fleetId, fleetKey: 'team', label: 'team', directory: fleet, revision: 0, digest: configuration.digest }]));
  value(registry.saveDesiredIntent([{ fleetId, instanceKey: 'first' }]));
  const sessions = new Map<string, string>();
  for (const instance of configuration.roster.instances) {
    const home = privateDir(join(fleet, instance.workarea, '.codex')), sessionId = randomUUID();
    sessions.set(instance.key, sessionId); writeJson(join(home, 'crossfire-session.json'), { sessionId });
  }
  const intent = readFileSync(join(root, 'desired-intent.json'));
  const assertOriginal = () => {
    for (const instance of configuration.roster.instances) assert.equal(readJson<{ sessionId: string }>(join(fleet,
      instance.workarea, '.codex/crossfire-session.json')).sessionId, sessions.get(instance.key));
  };
  const daemon = acquireFileLock(join(root, 'daemon'));
  try { await assert.rejects(migrateControllerContexts(root), /already owns/u); assertOriginal(); }
  finally { daemon(); }
  const second = configuration.roster.instances[1]!, local = paths(join(fleet, second.workarea), second.key);
  const receiver = acquireFileLock(join(local.state, 'receiver'));
  try { await assert.rejects(migrateControllerContexts(root), /already owns/u); assertOriginal(); }
  finally { receiver(); }
  assert.deepEqual(await migrateControllerContexts(root), { status: 'migrated', inspected: 2, migrated: 2, contexts: 2 });
  assert.deepEqual(readFileSync(join(root, 'desired-intent.json')), intent);
  for (const instance of configuration.roster.instances) assert.deepEqual(contextState(join(fleet, instance.workarea, '.codex')).state,
    { mode: 'shared', bindings: [{ context: 'shared', sessionId: sessions.get(instance.key) }] });
  assert.deepEqual(await migrateControllerContexts(root), { status: 'migrated', inspected: 2, migrated: 0, contexts: 2 });
});
