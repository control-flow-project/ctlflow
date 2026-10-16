import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import type { ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';

export async function operatorContracts(scope: TestContext, selected: Pick<ContractTarget, 'name' | 'server'>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'cf-operator-contracts-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, 'state'), bin = join(directory, 'bin'), calls = join(directory, 'docker-calls');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CROSSFIRE_OPERATOR_CONTRACT_DOCKER"\nprintf "[]\\n"\n', { mode: 0o700 });
  const environment = { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), CROSSFIRE_OPERATOR_CONTRACT_DOCKER: calls };
  const initialization = { directory: state, instance: 'operator-contracts', origin: 'http://127.0.0.1:8080',
    'content-origin': 'http://localhost:8082', 'server-name': 'operator.localhost', administrator: 'admin' };
  const init = ['init', ...Object.entries(initialization).flatMap(([key, value]) => ['--' + key, value])];
  const options = { directory: state, package: join(directory, 'unopened-package'), port: '8080', 'content-port': '8082', 'cgroup-parent': 'app-operator-contracts.slice' };
  const start = ['start', ...Object.entries(options).flatMap(([key, value]) => ['--' + key, value])];
  function run(arguments_: string[]) {
    const result = spawnSync(selected.server.binary, [...selected.server.arguments, ...arguments_], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'Operator must exit normally rather than abort, time out or be killed');
    return result;
  }
  const initialized = run(init);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert(!existsSync(calls), 'Initialization must not call Docker');
  const configuration = readFileSync(join(state, 'config.json')), bootstrap = readFileSync(join(state, 'bootstrap.json'));
  const contents = readdirSync(state).sort();
  function preserved() {
    assert(readFileSync(join(state, 'config.json')).equals(configuration), 'Operator validation preserves configuration bytes');
    assert(readFileSync(join(state, 'bootstrap.json')).equals(bootstrap), 'Operator validation preserves credential bytes');
  }
  function rejected(arguments_: string[], diagnostic = /Port must be a canonical decimal integer within 1024\.\.65535|Duplicated or empty option --(?:port|content-port)|argument is ambiguous/u) {
    writeFileSync(calls, '', { mode: 0o600 });
    const result = run(arguments_);
    assert.equal(result.status, 1, 'Invalid arguments must use a normal error exit: ' + JSON.stringify(arguments_));
    assert.match(result.stderr, diagnostic);
    assert.equal(readFileSync(calls, 'utf8'), '', 'Invalid arguments must fail before native Docker operations');
    assert.deepEqual(readdirSync(state).sort(), contents, 'Invalid arguments must not create a state lock or other state files');
    preserved();
  }
  await scope.test('repeated initialization and startup options reject identical and different values', () => {
    for (const [arguments_, values] of [[init, initialization], [start, options]] as const)
      for (const [key, value] of Object.entries(values)) for (const repeated of [value, 'different'])
        rejected([...arguments_, '--' + key, repeated], /Duplicated.*option/u);
    assert(!existsSync(join(directory, 'different')), 'Repeated directory options cannot initialize another state directory');
  });
  await scope.test('both port options reject noncanonical notation and out-of-range values before state changes', () => {
    const invalid = ['0', '1023', '65536', '99999999999999999999', '08080', '00001024', '+8080', '-8080',
      ' 8080', '8080 ', '\t8080', '8080\n', '8080\r', '8080\u2028', '8080.0', '8e3', '1e4', '1e309',
      '0x1F90', '0o17620', '0b11111100000', '8_080', 'NaN', 'Infinity', '٨٠٨٠', '８０８０', '8٠80', '8０80', ''];
    for (const key of ['port', 'content-port']) for (const value of invalid)
      rejected(['start', '--directory', state, '--package', options.package, '--' + key, value]);
  });
  await scope.test('canonical but conflicting application and content ports are rejected', () => {
    rejected(['start', '--directory', state, '--package', options.package, '--port', '8080', '--content-port', '8080'], /Content and application ports must differ/u);
  });
  await scope.test('defaults and canonical boundary ports reach the native engine check without loading a package', () => {
    const admitted = [[], ['--port', '1024'], ['--port', '8080'], ['--port', '65535'],
      ['--content-port', '1024'], ['--content-port', '8083'], ['--content-port', '65535']];
    for (const values of admitted) {
      writeFileSync(calls, '', { mode: 0o600 });
      const result = run(['start', '--directory', state, '--package', options.package, ...values]);
      assert.equal(result.status, 1, 'The inert native engine is intentionally not rootless');
      assert.match(result.stderr, /rootless Docker engine/u);
      assert.equal(readFileSync(calls, 'utf8'), 'info --format {{json .SecurityOptions}}\n');
      preserved();
    }
    assert.deepEqual(readdirSync(state).sort(), [...contents, 'operator.lock'].sort(), 'Only admitted startup may create its private ownership lock');
  });
}
