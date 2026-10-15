import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { refreshAuthentication } from '@ctlflow/crossfire-adapter-codex/authentication';
import { prepareHome } from '@ctlflow/crossfire-adapter-codex/home';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';

function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-authentication-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'host'), stateDirectory = join(directory, 'state');
  for (const path of [source, stateDirectory]) mkdirSync(path, { mode: 0o700 });
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = source;
  cleanup(scope, () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  const home = prepareHome(stateDirectory), sourceFile = join(source, 'auth.json'), destination = join(home, 'auth.json');
  return { directory, source, stateDirectory, home, sourceFile, destination };
}

test('every activation atomically refreshes exact host login bytes while retaining native state', scope => {
  const { sourceFile, home, destination } = fixture(scope);
  writeFileSync(sourceFile, '{"auth_mode":"apikey","OPENAI_API_KEY":"first-fixture-only"}\n', { mode: 0o600 });
  const config = readFileSync(join(home, 'config.toml'));
  const history = '{"sessionId":"retained-fixture-native-history"}';
  writeFileSync(join(home, 'crossfire-context-registry.json'), history, { mode: 0o600 });
  assert.equal(refreshAuthentication(home).ok, true);
  const descriptorIdentity = statSync(destination).ino;
  writeFileSync(sourceFile, '{"auth_mode":"apikey","OPENAI_API_KEY":"second-fixture-only"}\n', { mode: 0o600 });
  assert.equal(refreshAuthentication(home).ok, true);
  assert.deepEqual(readFileSync(destination), readFileSync(sourceFile));
  assert.notEqual(statSync(destination).ino, descriptorIdentity, 'Refresh replaces the file instead of truncating a live inode');
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(join(home, 'config.toml')), config);
  assert.equal(readFileSync(join(home, 'crossfire-context-registry.json'), 'utf8'), history);
  assert.equal(readdirSync(home).some(name => name.startsWith('.crossfire-auth-')), false);
});

test('absent host file removes stale file authentication without a fallback or history mutation', scope => {
  const { source, home, destination } = fixture(scope);
  writeFileSync(destination, '{"OPENAI_API_KEY":"stale-fixture-only"}', { mode: 0o600 });
  assert.equal(refreshAuthentication(home).ok, true);
  assert.equal(existsSync(destination), false);
  rmSync(source, { recursive: true });
  assert.equal(refreshAuthentication(home).ok, true, 'A native environment-only provider does not require a file login home');
});

test('invalid, shared, oversized and linked host inputs fail closed without leaking credentials', scope => {
  const { directory, source, sourceFile, home, destination } = fixture(scope);
  const retained = '{"OPENAI_API_KEY":"retained-fixture-only"}', secret = 'must-not-be-disclosed';
  writeFileSync(destination, retained, { mode: 0o600 });
  const refused = () => {
    const result = refreshAuthentication(home);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error.code, 'unauthorized'); assert.equal(result.error.message.includes(secret), false); }
    assert.equal(readFileSync(destination, 'utf8'), retained);
    assert.equal(readdirSync(home).some(name => name.startsWith('.crossfire-auth-')), false);
  };
  for (const contents of [secret, 'null', '[]', '{"value":"' + secret.repeat(4000) + '"}']) {
    writeFileSync(sourceFile, contents, { mode: 0o600 }); refused();
  }
  writeFileSync(sourceFile, '{}'); chmodSync(sourceFile, 0o644); refused();
  chmodSync(sourceFile, 0o600); rmSync(sourceFile); mkdirSync(sourceFile, { mode: 0o700 }); refused();
  rmSync(sourceFile, { recursive: true });
  const other = join(directory, 'other'); writeFileSync(other, '{}', { mode: 0o600 });
  symlinkSync(other, sourceFile); refused(); rmSync(sourceFile); writeFileSync(sourceFile, '{}', { mode: 0o600 });
  const alias = join(directory, 'host-alias'); symlinkSync(source, alias); process.env.CODEX_HOME = alias; refused();
});

test('unsafe managed destinations are rejected without following or modifying unrelated files', scope => {
  const { directory, sourceFile, home, destination } = fixture(scope);
  writeFileSync(sourceFile, '{}', { mode: 0o600 });
  const other = join(directory, 'unrelated'); writeFileSync(other, 'unrelated', { mode: 0o600 });
  symlinkSync(other, destination);
  assert.equal(refreshAuthentication(home).ok, false); assert.equal(readFileSync(other, 'utf8'), 'unrelated');
  rmSync(destination); linkSync(other, destination);
  assert.equal(refreshAuthentication(home).ok, false); assert.equal(readFileSync(other, 'utf8'), 'unrelated');
  rmSync(destination); mkdirSync(destination, { mode: 0o700 }); assert.equal(refreshAuthentication(home).ok, false);
  rmSync(destination, { recursive: true }); writeFileSync(destination, '{}', { mode: 0o644 });
  assert.equal(refreshAuthentication(home).ok, false);
});

test('managed native home cannot be its own source and private malformed old contents are replaced', scope => {
  const { sourceFile, home, destination } = fixture(scope);
  writeFileSync(sourceFile, '{}', { mode: 0o600 }); writeFileSync(destination, 'broken previous login', { mode: 0o600 });
  assert.equal(refreshAuthentication(home).ok, true); assert.equal(readFileSync(destination, 'utf8'), '{}');
  process.env.CODEX_HOME = home;
  const result = refreshAuthentication(home);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'invalid');
  assert.equal(readFileSync(destination, 'utf8'), '{}');
});

test('invalid or cancelled credential refresh never starts or replaces native histories', async scope => {
  const { stateDirectory, sourceFile, home, destination } = fixture(scope);
  writeFileSync(sourceFile, 'invalid-private-login', { mode: 0o600 });
  const input = { profile: 'auth-proof', name: 'auth-proof', workspace: stateDirectory, stateDirectory, instructions: 'No native model invocation.',
    options: {}, allowNewHistory: true, hooks: { requestDecision: async () => { throw new Error('No native execution'); } } };
  const adapter = codexRuntime('/missing-native-binary');
  const result = await adapter.start(input, new AbortController().signal);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'unauthorized');
  assert.equal(existsSync(destination), false); assert.equal(existsSync(join(home, 'crossfire-context-registry.json')), false);
  writeFileSync(sourceFile, '{}', { mode: 0o600 });
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await adapter.start(input, cancelled.signal)).ok, false);
  assert.equal(existsSync(destination), false); assert.equal(existsSync(join(home, 'crossfire-context-registry.json')), false);
});
