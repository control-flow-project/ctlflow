import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(process.cwd(), 'scripts/setup-vm-host.sh');
const operator = userInfo().username;
// These admission tests must never acquire root or reach package installation.
assert.notEqual(process.getuid?.(), 0, 'Run VM host setup admission tests as a non-root user');

function run(args: string[]) {
  const result = spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536,
  });
  assert.equal(result.error, undefined, 'The setup command must complete within its admission bound');
  return result;
}

test('VM host setup has valid Bash syntax and documents separate runtime accounts', () => {
  assert.equal(spawnSync('/bin/bash', ['-n', script]).status, 0);
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--runtime-user FLEET_USER/);
  assert.match(result.stdout, /KVM access only, never libvirt administration/);
});

const refusals: ReadonlyArray<readonly [string, string[], RegExp]> = [
  ['missing operator', [], /Supply an existing local non-root account/],
  ['missing operator value', ['--user'], /--user requires a value/],
  ['duplicate operator', ['--user', operator, '--user', operator], /supplied twice/],
  ['root operator', ['--user', 'root'], /non-root account/],
  ['unknown option', ['--delete'], /Unknown argument/],
  ['missing runtime value', ['--user', operator, '--runtime-user'], /requires a value/],
  ['root runtime', ['--user', operator, '--runtime-user', 'root'], /non-root account/],
  ['operator reused as runtime', ['--user', operator, '--runtime-user', operator], /must be separate/],
  ['duplicate runtime', ['--user', operator, '--runtime-user', 'nobody', '--runtime-user', 'nobody'], /Duplicate --runtime-user/],
  ['unsafe account text', ['--user', operator, '--runtime-user', '$(id)'], /existing local non-root account/],
  ['installation without sudo', ['--user', operator], /Run setup with sudo/],
  ['other-account check without sudo', ['--check', '--user', operator, '--runtime-user', 'nobody'], /Checking other runtime accounts requires sudo/],
];

for (const [name, args, message] of refusals) {
  test('VM host setup refuses ' + name + ' before changing the host', () => {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
  });
}
