import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';

function workspace(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'native-context-metadata-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('saved native contexts are read without starting an engine, initializing a home or requiring provider login', async scope => {
  const directory = workspace(scope), adapter = codexRuntime('/this-native-binary-must-not-be-executed');
  assert.deepEqual(await adapter.savedContexts({ workspace: directory }), { ok: true, value: [] });
  assert.equal(existsSync(join(directory, '.codex')), false);
  const home = join(directory, '.codex'); mkdirSync(home, { mode: 0o700 });
  assert.deepEqual(await adapter.savedContexts({ workspace: directory }), { ok: true, value: [] });
  assert.deepEqual(readdirSync(home), []);
  const shared = randomUUID(), control = randomUUID(), room = randomUUID();
  writeFileSync(join(home, 'crossfire-session.json'), JSON.stringify({ sessionId: shared }), { mode: 0o600 });
  for (const mode of ['shared', 'per-room']) {
    writeFileSync(join(home, 'crossfire-contexts.json'), JSON.stringify({ mode, control, rooms: [{ room: '!alpha:test', sessionId: room }] }), { mode: 0o600 });
    const result = await adapter.savedContexts({ workspace: directory }); assert(result.ok);
    assert.deepEqual(result.value, [
      { context: 'shared', runtime: 'codex', sessionId: shared, workspace: directory },
      { context: 'control', runtime: 'codex', sessionId: control, workspace: directory },
      { context: '!alpha:test', runtime: 'codex', sessionId: room, workspace: directory },
    ]);
    assert.deepEqual(readdirSync(home).sort(), ['crossfire-contexts.json', 'crossfire-session.json']);
  }
});

test('invalid or unsafe native metadata never becomes an empty or guessed history', async scope => {
  const directory = workspace(scope), home = join(directory, '.codex'), adapter = codexRuntime('/not-executed');
  mkdirSync(home, { mode: 0o700 });
  const shared = randomUUID(), file = join(home, 'crossfire-contexts.json');
  writeFileSync(join(home, 'crossfire-session.json'), JSON.stringify({ sessionId: shared }), { mode: 0o600 });
  for (const invalid of [{ mode: 'shared', control: shared, rooms: [] },
    { mode: 'shared', control: null, rooms: [{ room: '!alpha:test', sessionId: randomUUID() }, { room: '!alpha:test', sessionId: randomUUID() }] },
    { mode: 'per-room', control: null, rooms: [{ room: '!alpha:test', sessionId: shared }] },
    { mode: 'per-room', control: null, rooms: [{ room: '!alpha:test', sessionId: 'unknown-native-session' }] },
    { mode: 'legacy', control: null, rooms: [] }, { mode: 'shared', control: null, rooms: [], extra: true }]) {
    writeFileSync(file, JSON.stringify(invalid), { mode: 0o600 });
    const result = await adapter.savedContexts({ workspace: directory }); assert.equal(result.ok, false, JSON.stringify(invalid));
    if (!result.ok) assert.equal(result.error.code, 'invalid');
  }
  writeFileSync(file, '{', { mode: 0o600 }); assert.equal((await adapter.savedContexts({ workspace: directory })).ok, false);
  rmSync(file); symlinkSync(join(directory, 'missing'), file);
  assert.equal((await adapter.savedContexts({ workspace: directory })).ok, false, 'A dangling metadata symlink is not absent state');
  rmSync(file); chmodSync(home, 0o755);
  assert.equal((await adapter.savedContexts({ workspace: directory })).ok, false);
  chmodSync(home, 0o700);
  const alias = join(directory, 'alias'); symlinkSync(directory, alias);
  assert.equal((await adapter.savedContexts({ workspace: alias })).ok, false);
  rmSync(join(home, 'crossfire-session.json')); rmdirSync(home); symlinkSync(join(directory, 'missing-home'), home);
  assert.equal((await adapter.savedContexts({ workspace: directory })).ok, false);
});
