import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { authenticated, configurationDirectory, configurationRoot, decodeAuthentication, initializeAuthentication, readAuthentication } from '@ctlflow/fleetd-storage/authentication';
import cases from '../../tests/contracts/authentication-cases.json' with { type: 'json' };
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';

function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-auth-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'ctlflow/fleetd.json');
  return { directory, file };
}

test('authentication and CLI configuration use the native OS configuration root', () => {
  assert.equal(configurationRoot('linux', '/home/operator', undefined), '/home/operator/.config');
  assert.equal(configurationDirectory('linux', '/home/operator', '/private/config'), '/private/config/ctlflow');
  assert.equal(configurationDirectory('darwin', '/Users/operator', '/ignored'), '/Users/operator/Library/Application Support/ctlflow');
  assert.throws(() => configurationDirectory('linux', '/home/operator', '/private/config/'));
  assert.throws(() => configurationDirectory('linux', '/home/operator/', undefined));
  for (const [platform, home, xdg] of [['win32', '/home/operator', undefined], ['linux', 'relative', undefined], ['linux', '/home/operator/../other', undefined], ['linux', '/home/operator', ''], ['linux', '/home/operator', 'relative'], ['linux', '/home/operator', '/private/../other'], ['linux', '/home/operator', '/private/./other'], ['linux', '/home/operator', '/private//other']] as const) {
    assert.throws(() => configurationDirectory(platform, home, xdg));
  }
});

test('all native targets share strict configuration decoding cases', () => {
  for (const selected of cases.valid) assert.equal(decodeAuthentication(Buffer.from(selected.text)).authenticationKey ?? null, selected.key, selected.label);
  for (const input of cases.invalid) assert.throws(() => decodeAuthentication(Buffer.from(input)), error => error instanceof Error && /Invalid fleetd configuration/u.test(error.message) && !error.message.includes('do-not-leak-secret'));
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.alloc(4097, 32)]) assert.throws(() => decodeAuthentication(bytes));
});

test('a missing client credential fails without sending a daemon request or exposing its source error', async () => {
  const client = createDaemonClient('/absent/fleetd.sock', undefined, () => { throw new Error('do-not-leak-secret'); });
  const result = await client.call(operations.status, {}, {});
  assert(!result.ok); assert.equal(result.error.code, 'unauthorized'); assert(!result.error.message.includes('do-not-leak-secret'));
});

test('fleetd alone creates private random configuration; repeated and concurrent initialization retains one key', async scope => {
  const { directory, file } = fixture(scope);
  assert.throws(() => readAuthentication(file), /start fleetd/u);
  assert(!existsSync(join(directory, 'ctlflow')), 'A client read creates nothing');
  const keys: string[] = [];
  for (let index = 0; index < 8; index++) keys.push(await initializeAuthentication(file));
  const current = readAuthentication(file), original = lstatSync(file);
  assert.match(current, /^[a-f0-9]{64}$/u); assert.equal(new Set(keys).size, 1);
  assert.equal(original.mode & 0o777, 0o600); assert.equal(lstatSync(join(directory, 'ctlflow')).mode & 0o777, 0o700);
  assert.equal(await initializeAuthentication(file), current); assert.equal(lstatSync(file).mtimeMs, original.mtimeMs); assert.equal(lstatSync(file).ino, original.ino);
  const another = join(directory, 'other/fleetd.json'); assert.notEqual(await initializeAuthentication(another), current);
  const concurrent = join(directory, 'concurrent/fleetd.json');
  const initializers = Array.from({ length: 8 }, () => initializeAuthentication(concurrent));
  const concurrentKeys = await Promise.all(initializers); assert.equal(new Set(concurrentKeys).size, 1);
  assert.equal(concurrentKeys[0], readAuthentication(concurrent));
  assert(authenticated('Bearer ' + current, current));
  for (const header of [undefined, '', current, 'bearer ' + current, 'Bearer ' + 'f'.repeat(64), 'Bearer ' + current + ', Bearer ' + current]) assert(!authenticated(header, current));
});

test('missing key is inserted into valid configuration; malformed or unsafe files are not replaced', async scope => {
  const { directory, file } = fixture(scope); mkdirSync(join(directory, 'ctlflow'), { mode: 0o700 });
  writeFileSync(file, '{"schemaVersion":1}', { mode: 0o600 });
  assert.throws(() => readAuthentication(file), /start fleetd/u); const key = await initializeAuthentication(file);
  assert.equal(readAuthentication(file), key);
  for (const content of [...cases.invalid, ' '.repeat(4097)]) {
    writeFileSync(file, content); await assert.rejects(initializeAuthentication(file));
    assert.equal(readFileSync(file, 'utf8'), content);
  }
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, authenticationKey: key }));
  chmodSync(file, 0o644); await assert.rejects(initializeAuthentication(file)); assert.equal(lstatSync(file).mode & 0o777, 0o644); chmodSync(file, 0o600);
  chmodSync(join(directory, 'ctlflow'), 0o755); await assert.rejects(initializeAuthentication(file)); chmodSync(join(directory, 'ctlflow'), 0o700);
  const linked = join(directory, 'ctlflow/linked.json'); linkSync(file, linked); assert.throws(() => readAuthentication(file)); unlinkSync(linked);
  const content = readFileSync(file); unlinkSync(file); writeFileSync(linked, content, { mode: 0o600 }); symlinkSync(linked, file); await assert.rejects(initializeAuthentication(file)); unlinkSync(file);
  execFileSync('mkfifo', [file]); await assert.rejects(initializeAuthentication(file)); unlinkSync(file);
  symlinkSync(join(directory, 'absent'), file); await assert.rejects(initializeAuthentication(file));
});
