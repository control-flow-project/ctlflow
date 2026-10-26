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
  function rejected(arguments_: string[], diagnostic?: RegExp) {
    writeFileSync(calls, '', { mode: 0o600 });
    const result = run(arguments_);
    assert.equal(result.status, 1, 'Invalid arguments must use a normal error exit: ' + JSON.stringify(arguments_));
    if (diagnostic) assert.match(result.stderr, diagnostic);
    else assert(result.stderr.trim(), 'Rejected commands must report a diagnostic');
    assert.equal(readFileSync(calls, 'utf8'), '', 'Invalid arguments must fail before native Docker operations');
    assert.deepEqual(readdirSync(state).sort(), contents, 'Invalid arguments must not create a state lock or other state files');
    preserved();
  }
  await scope.test('backend initialization rejects invalid native parameters before writing state or invoking Docker', () => {
    const invalid: [string, string][] = [
      ['administrator', 'conduit'], ['administrator', 'agent-system'], ['administrator', 'crossfire-service'],
      ['administrator', 'Uppercase'], ['administrator', 'with space'], ['administrator', 'human:other'],
      ['server-name', 'bad/host'], ['server-name', 'bad host'], ['server-name', 'example:port'], ['server-name', 'a'.repeat(201)],
    ];
    for (const [index, [key, value]] of invalid.entries()) {
      const unopened = join(directory, 'invalid-' + index);
      const values = { ...initialization, directory: unopened, [key]: value };
      writeFileSync(calls, '', { mode: 0o600 });
      const result = run(['init', ...Object.entries(values).flatMap(([name, text]) => ['--' + name, text])]);
      assert.equal(result.status, 1, 'Invalid native initialization parameters must be rejected');
      assert.equal(existsSync(unopened), false, 'Invalid native configuration cannot create private state');
      assert.equal(readFileSync(calls, 'utf8'), '', 'Backend configuration validation cannot invoke Docker');
      preserved();
    }
  });
  await scope.test('repeated initialization options reject identical and different values', () => {
    for (const [key, value] of Object.entries(initialization)) for (const repeated of [value, 'different'])
      rejected([...init, '--' + key, repeated], /Duplicated.*option/u);
    assert(!existsSync(join(directory, 'different')), 'Repeated directory options cannot initialize another state directory');
  });
  await scope.test('configuration initialization cannot overwrite existing state', () => {
    rejected(init, /nonempty|empty|overwrites/u);
  });
  await scope.test('removed Docker deployment commands and options are rejected without touching Docker or state', () => {
    for (const arguments_ of [
      ['start'], ['start', '--directory', state], ['start', '--package', '/removed'],
      ['start', '--port', '8080', '--content-port', '8082'],
      ...['package', 'port', 'content-port', 'cgroup-parent', 'compile', 'source', 'runtime'].map(key => [...init, '--' + key, 'removed']),
    ]) rejected(arguments_);
  });
}
