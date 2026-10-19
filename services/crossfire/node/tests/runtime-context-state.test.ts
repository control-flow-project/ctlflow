import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { CONTEXT_REGISTRY } from '@ctlflow/crossfire-adapter-codex/context-state';

function workspace(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'native-context-metadata-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('saved native contexts are read without starting an engine, initializing a home or requiring provider login', async scope => {
  const directory = workspace(scope), adapter = codexRuntime('/this-native-binary-must-not-be-executed');
  assert.deepEqual(await adapter.savedContexts({ workspace: directory, stateDirectory: directory }), { ok: true, value: [] });
  assert.equal(existsSync(join(directory, '.codex')), false);
  const home = join(directory, '.codex'); mkdirSync(home, { mode: 0o700 });
  assert.deepEqual(await adapter.savedContexts({ workspace: directory, stateDirectory: directory }), { ok: true, value: [] });
  assert.deepEqual(readdirSync(home), []);
  const shared = randomUUID(), control = randomUUID(), room = randomUUID();
  for (const mode of ['shared', 'per-room']) {
    writeFileSync(join(home, CONTEXT_REGISTRY), JSON.stringify({ mode, bindings: [{ context: 'shared', sessionId: shared },
      { context: 'control', sessionId: control }, { context: 'room/control', sessionId: room }] }), { mode: 0o600 });
    const result = await adapter.savedContexts({ workspace: directory, stateDirectory: directory }); assert(result.ok);
    assert.deepEqual(result.value, [
      { context: 'shared', runtime: 'codex', sessionId: shared, workspace: directory },
      { context: 'control', runtime: 'codex', sessionId: control, workspace: directory },
      { context: 'room/control', runtime: 'codex', sessionId: room, workspace: directory },
    ]);
    assert.deepEqual(readdirSync(home), [CONTEXT_REGISTRY]);
  }
});

test('invalid or unsafe native metadata never becomes an empty or guessed history', async scope => {
  const directory = workspace(scope), home = join(directory, '.codex'), adapter = codexRuntime('/not-executed');
  mkdirSync(home, { mode: 0o700 });
  const shared = randomUUID(), file = join(home, CONTEXT_REGISTRY);
  for (const invalid of [{ mode: 'shared', bindings: [{ context: 'shared', sessionId: shared }, { context: 'control', sessionId: shared }] },
    { mode: 'shared', bindings: [{ context: 'room/control', sessionId: randomUUID() }, { context: 'room/control', sessionId: randomUUID() }] },
    { mode: 'per-room', bindings: [{ context: 'shared', sessionId: shared }, { context: 'room/control', sessionId: shared }] },
    { mode: 'per-room', bindings: [{ context: 'room/control', sessionId: 'unknown-native-session' }] },
    { mode: 'legacy', bindings: [] }, { mode: 'shared', bindings: [], extra: true }]) {
    writeFileSync(file, JSON.stringify(invalid), { mode: 0o600 });
    const result = await adapter.savedContexts({ workspace: directory, stateDirectory: directory }); assert.equal(result.ok, false, JSON.stringify(invalid));
    if (!result.ok) assert.equal(result.error.code, 'invalid');
  }
  writeFileSync(file, '{', { mode: 0o600 }); assert.equal((await adapter.savedContexts({ workspace: directory, stateDirectory: directory })).ok, false);
  rmSync(file); symlinkSync(join(directory, 'missing'), file);
  assert.equal((await adapter.savedContexts({ workspace: directory, stateDirectory: directory })).ok, false, 'A dangling metadata symlink is not absent state');
  rmSync(file); chmodSync(home, 0o755);
  assert.equal((await adapter.savedContexts({ workspace: directory, stateDirectory: directory })).ok, false);
  chmodSync(home, 0o700);
  const alias = join(directory, 'alias'); symlinkSync(directory, alias);
  assert.equal((await adapter.savedContexts({ workspace: alias, stateDirectory: directory })).ok, false);
  rmdirSync(home); symlinkSync(join(directory, 'missing-home'), home);
  assert.equal((await adapter.savedContexts({ workspace: directory, stateDirectory: directory })).ok, false);
});

test('saved contexts belong to private managed state, never the existing native project home', async scope => {
  const directory = workspace(scope), project = join(directory, 'project'), stateDirectory = join(directory, 'managed');
  mkdirSync(project, { mode: 0o755 }); mkdirSync(stateDirectory, { mode: 0o700 });
  const nativeHome = join(project, '.codex'), managedHome = join(stateDirectory, '.codex');
  mkdirSync(nativeHome, { mode: 0o700 }); mkdirSync(managedHome, { mode: 0o700 });
  const existing = randomUUID(), managed = randomUUID(), adapter = codexRuntime('/not-executed');
  writeFileSync(join(nativeHome, CONTEXT_REGISTRY), JSON.stringify({ mode: 'shared', bindings: [{ context: 'shared', sessionId: existing }] }), { mode: 0o600 });
  writeFileSync(join(managedHome, CONTEXT_REGISTRY), JSON.stringify({ mode: 'shared', bindings: [{ context: 'shared', sessionId: managed }] }), { mode: 0o600 });
  assert.deepEqual(await adapter.savedContexts({ workspace: project, stateDirectory }), { ok: true,
    value: [{ context: 'shared', runtime: 'codex', sessionId: managed, workspace: project }] });
  assert.deepEqual(readdirSync(nativeHome), [CONTEXT_REGISTRY]);
  const alias = join(directory, 'state-alias'); symlinkSync(stateDirectory, alias);
  assert.equal((await adapter.savedContexts({ workspace: project, stateDirectory: alias })).ok, false);
});
