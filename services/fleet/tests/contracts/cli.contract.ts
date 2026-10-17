import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { acquireFileLock, acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { contractProcess, integer, list, observe, record, text, type ContractCommand, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import type { ContractPlatform } from '@ctlflow/crossfire-test-support/contract-platform';
import { sshFixture } from './ssh-fixture.js';
import { readAuthentication } from '@ctlflow/fleetd-storage/authentication';

export async function cliContracts(scope: TestContext, platform: ContractPlatform, selected: ContractTarget, runtime: 'codex' | 'pi'): Promise<void> {
  const directory = join(platform.directory, 'c-' + runtime); mkdirSync(directory, { mode: 0o700 }); const root = join(directory, 'd'), home = join(directory, 'home'), fleet = join(directory, 'fleet'); mkdirSync(home, { mode: 0o700 });
  const provider = runtime === 'codex' ? await nativeProvider(scope, home) : await piProvider(scope);
  const binaries = join(directory, 'bin'); mkdirSync(binaries, { mode: 0o700 }); symlinkSync(piBinary(), join(binaries, 'pi'));
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: binaries + delimiter + (process.env.PATH ?? '') };
  const nativeOptions = runtime === 'codex' ? 'sandbox_mode = "read-only"\napproval_policy = "never"\n' : 'provider = "fixture"\nmodel = "fixture-model"\n';
  const effort = runtime === 'codex' ? 'model_reasoning_effort' : 'thinking_level';
  let configuredId = '';
  async function execute(command: ContractCommand, args: string[]) { const process = contractProcess(scope, command, args, directory, environment); let expired = false; const timer = setTimeout(() => { expired = true; void process.close(); }, 30000); try { const code = await process.ended; assert(!expired, 'CLI must finish and detach its controller standard streams within its deadline'); return { code, output: process.output(), error: process.errors() }; } finally { clearTimeout(timer); await process.close(); } }
  const cli = (...args: string[]) => execute(selected.cli, args);
  async function json(...args: string[]) { const result = await cli(...args); assert.equal(result.code, 0, result.error); return JSON.parse(result.output) as unknown; }
  cleanup(scope, async () => { await cli('daemon', 'stop', '--root', root); });
  await scope.test('invalid start syntax cannot create a controller or native session', async () => {
    for (const words of [['start'], ['start', 'one', 'extra'], ['agent', 'start', 'one'], ['agent', 'start', 'one', 'two', 'extra'],
      ['start', 'INVALID'], ['start', 'one', '--operation-id', 'not-a-uuid'], ['agent', 'start', 'one', 'INVALID'],
      ['agent', 'start', 'one', 'two', '--operation-id=not-a-uuid'], ['start', 'one', '--fresh-history', '--fresh-history'],
      ['daemon', 'start', '--name', 'invalid\nname'], ['start', 'one', '--root', root]]) {
      assert.notEqual((await cli(...words, '--root', root)).code, 0);
      assert.equal(existsSync(root), false, 'Validate start syntax before controller activation');
    }
    assert.equal(provider.requests.length, 0);
  });
  await scope.test('CLI starts one named controller and persists the default connection', async () => {
    const first = record(await json('daemon', 'start', '--root', root, '--name', 'cli-contract')); const second = record(await json('daemon', 'start', '--root', root, '--name', 'cli-contract')); assert.equal(first.startedAt, second.startedAt); assert.equal(record(first.controller).name, 'cli-contract'); assert.equal(statSync(join(root, 'fleetd.sock')).mode & 0o777, 0o600); assert.notEqual((await cli('daemon', 'start', '--root', root, '--name', 'different')).code, 0);
  });
  await scope.test('all lifecycle orchestration goes through the same daemon API', async () => {
    mkdirSync(join(fleet, 'agents/analyst'), { recursive: true, mode: 0o700 }); writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "cli-research-' + runtime + '"\ninstances = []\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n', { mode: 0o600 }); writeFileSync(join(fleet, 'agents/analyst/agent.toml'), 'name = "Analyst"\nruntime = ' + JSON.stringify(runtime) + '\n[runtime_options]\n' + nativeOptions, { mode: 0o600 }); writeFileSync(join(fleet, 'agents/analyst/AGENTS.md'), 'Retain this authored role.\n', { mode: 0o600 });
    const added = record(await json('add', fleet)); const id = text(added.fleetId); assert.equal(list(await json('list')).length, 1); const expanded = record(await json('agent', 'add', 'cli-research-' + runtime, 'analyst', '--definition', 'analyst')); assert(integer(expanded.revision) > integer(added.revision)); assert.equal(list(await json('agent', 'list', id)).length, 1); assert.deepEqual(await json('agent', 'contexts', id, 'analyst'), []); assert.notEqual((await cli('agent', 'attach', id, 'analyst')).code, 0);
    await json('agent', 'remove', id, 'analyst'); await json('remove', id); assert.equal(list(await json('list')).length, 0); assert.notEqual((await cli('list', '--fresh-history')).code, 0); assert.notEqual((await cli('list', '--root', root, '--remote', 'other')).code, 0);
  });
  await scope.test('every installed CLI reads the selected controller through the identical authenticated API', async () => {
    const before = record(await json('daemon', 'status'));
    for (const target of platform.targets) {
      const status = await execute(target.cli, ['daemon', 'status', '--root', root]);
      assert.equal(status.code, 0, target.name + ': ' + status.error);
      const current = record(JSON.parse(status.output) as unknown);
      assert.deepEqual(current.controller, before.controller); assert.equal(current.startedAt, before.startedAt);
      const fleets = await execute(target.cli, ['list', '--root', root]);
      assert.equal(fleets.code, 0, target.name + ': ' + fleets.error);
      assert.deepEqual(JSON.parse(fleets.output) as unknown, []);
    }
    assert.equal(provider.requests.length, 0, 'Cross-implementation inspection cannot start native work');
  });
  await scope.test('CLI daemon shutdown is resumable without installing a host service', async () => {
    await json('daemon', 'stop'); await observe(async () => { try { await contractHttp('http://localhost', 'GET', '/api/status', undefined, {}, join(root, 'fleetd.sock')); return false; } catch { return true; } }, 'Daemon must finish stopping');
    const restarted = record(await json('daemon', 'start')); assert.equal(record(restarted.controller).name, 'cli-contract'); assert.equal(list(await json('list')).length, 0);
  });
  await scope.test('CLI waits for the exact previous daemon owner before launching its replacement', async () => {
    await json('daemon', 'stop');
    const release = await acquireProcessLock(join(root, 'daemon'), 100, 100);
    const starting = contractProcess(scope, selected.cli, ['daemon', 'start', '--root', root], directory, environment);
    try {
      await observe(() => {
        assert(starting.alive(), starting.errors());
        try { const unlock = acquireFileLock(join(root, 'launcher')); unlock(); return false; }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') return true; throw error; }
      }, 'The installed CLI holds its launcher while the previous daemon still owns the root');
      const observing = performance.now();
      await observe(() => { assert(starting.alive(), starting.errors()); return performance.now() - observing >= 500; },
        'A closing controller owner cannot cause an immediate failed or overlapping launch', 2000);
      await release();
      await observe(() => !starting.alive(), 'The installed CLI finishes after the previous daemon releases ownership');
      assert.equal(await starting.ended, 0, starting.errors());
      assert.equal(record(record(JSON.parse(starting.output()) as unknown).controller).name, 'cli-contract');
      assert.equal(provider.requests.length, 0);
    } finally { await release(); await starting.close(); }
  });
  await scope.test('actual SSH forwards the same private API and rejects an untrusted host', async child => {
    const ssh = await sshFixture(child, environment.XDG_CONFIG_HOME!), previous = environment.PATH; environment.PATH = ssh.bin + delimiter + (previous ?? '');
    try {
      await json('remote', 'add', 'verified-remote', '--ssh', 'fixture', '--root', root);
      assert.deepEqual(await json('list', '--remote', 'verified-remote'), []);
      const file = join(environment.XDG_CONFIG_HOME!, 'ctlflow/fleetd.json'), original = readFileSync(file), key = readAuthentication(file);
      try {
        chmodSync(file, 0o644); const publicFile = await cli('list', '--remote', 'verified-remote');
        assert.notEqual(publicFile.code, 0, 'SSH refuses a public authentication file'); assert(!(publicFile.output + publicFile.error).includes(key), 'Errors never expose remote credentials');
        chmodSync(file, 0o600); writeFileSync(file, '{"schemaVersion":1,"authenticationKey":"' + key + '","invalid":true}');
        const invalid = await cli('list', '--remote', 'verified-remote'); assert.notEqual(invalid.code, 0); assert(!(invalid.output + invalid.error).includes(key));
      } finally { chmodSync(file, 0o600); writeFileSync(file, original); }
      assert.deepEqual(await json('list', '--remote', 'verified-remote'), []);
      ssh.distrust(); assert.notEqual((await cli('list', '--remote', 'verified-remote')).code, 0, 'Wrong SSH host keys never receive implicit trust');
      assert.equal(record(record(await json('daemon', 'status')).controller).name, 'cli-contract', 'Tunnel teardown never stops its remote controller');
    } finally { if (previous === undefined) delete environment.PATH; else environment.PATH = previous; }
  });
  await scope.test('noninteractive setup completes real enrollment and preserves history and explicit stop on repetition', async () => {
    const configured = join(directory, 'configured'), role = join(configured, 'agents/analyst'); mkdirSync(role, { recursive: true, mode: 0o700 });
    writeFileSync(join(role, 'agent.toml'), 'name = "Setup analyst"\nruntime = ' + JSON.stringify(runtime) + '\n[runtime_options]\n' + nativeOptions + effort + ' = "high"\n', { mode: 0o600 }); writeFileSync(join(role, 'AGENTS.md'), 'Setup makes no model prompt. Preserve identity and existing history.\n', { mode: 0o600 });
    const configuration = join(configured, 'runtime.toml'); writeFileSync(configuration, 'fleet = "setup-contract-' + runtime + '"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n[[instances]]\nkey = "setup-analyst"\nname = "setup-analyst-' + runtime + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/setup-analyst"\n', { mode: 0o600 });
    const starting = contractProcess(scope, selected.cli, ['setup', '--config', configuration], directory, environment); const approved = new Set<string>();
    try {
      await observe(async () => {
        assert(starting.alive() || starting.child.exitCode === 0, starting.errors() + '\n' + starting.output());
        const operationId = /"operationId"\s*:\s*"([a-f0-9-]{36})"/u.exec(starting.output())?.[1];
        if (operationId) {
          const response = await contractHttp('http://localhost', 'GET', '/api/operations/' + operationId, undefined, { Authorization: 'Bearer ' + readAuthentication(join(environment.XDG_CONFIG_HOME!, 'ctlflow/fleetd.json')) }, join(root, 'fleetd.sock')); assert.equal(response.status, 200); const operation = record(record(response.body).data);
          if (operation.approval !== null) { const approval = record(operation.approval), id = new URL(text(approval.url)).pathname.split('/').at(-1)!; if (!approved.has(id)) { approved.add(id); await platform.approve(id, text(approval.code)); } }
        }
        return starting.child.exitCode === 0;
      }, 'Setup finishes without stdin prompts after explicit human enrollment approval', 90000);
      assert.equal(await starting.ended, 0); assert.match(starting.output(), /"status"\s*:\s*"ready"/u); assert.equal(approved.size, 1);
    } finally { await starting.close(); }
    const fleets = list(await json('list')); assert.equal(fleets.length, 1); const id = text(record(fleets[0]).fleetId); configuredId = id; const histories = await json('agent', 'contexts', id, 'setup-analyst'); assert.equal(list(histories).length, 1);
    const repeated = await cli('setup'); assert.equal(repeated.code, 0, repeated.error); assert.match(repeated.output, /"status"\s*:\s*"ready"/u); assert.deepEqual(await json('agent', 'contexts', id, 'setup-analyst'), histories);
    const stopped = await cli('stop', id); assert.equal(stopped.code, 0, stopped.error); const retained = await cli('setup'); assert.equal(retained.code, 0, retained.error); assert.match(retained.output, /"status"\s*:\s*"stopped"/u);
    assert.deepEqual(await json('agent', 'contexts', id, 'setup-analyst'), histories); assert.equal(provider.requests.length, 0, 'Initial/repeated setup never performs model housekeeping or a fresh-history reset');
  });
  await scope.test('explicit instance resume, replay, update and fresh history use the same retained fleet identity', async () => {
    const requests = provider.requests.length, before = await json('agent', 'contexts', configuredId, 'setup-analyst');
    const bindingFile = join(directory, 'configured/.fleet/binding.json'), binding = readFileSync(bindingFile);
    const started = await cli('agent', 'start', configuredId, 'setup-analyst'); assert.equal(started.code, 0, started.error);
    assert.deepEqual(await json('agent', 'contexts', configuredId, 'setup-analyst'), before);
    assert.equal(record(await json('test', configuredId)).accepted, true);
    const pointer = await cli('agent', 'attach', configuredId, 'setup-analyst');
    assert.equal(pointer.code === 0, runtime === 'codex', 'Only Codex exposes an existing-process terminal attachment');
    const operationId = randomUUID(), stop = ['agent', 'stop', configuredId, 'setup-analyst', '--operation-id', operationId];
    assert.equal((await cli(...stop)).code, 0); assert.equal((await cli(...stop)).code, 0);
    assert.notEqual((await cli('agent', 'start', configuredId, 'setup-analyst', '--operation-id', operationId)).code, 0);
    assert.equal(record(list(record(await json('show', configuredId)).instances)[0]).desiredActive, false);
    assert.notEqual((await cli('test', configuredId)).code, 0, 'Readiness never resumes a stopped agent');
    for (const words of [['agent', 'update', configuredId, 'setup-analyst'], ['update', configuredId]]) {
      const updated = await cli(...words, '--release-directory', platform.releaseDirectory); assert.equal(updated.code, 0, updated.error);
      assert.equal(record(list(record(await json('show', configuredId)).instances)[0]).desiredActive, false);
      assert.deepEqual(await json('agent', 'contexts', configuredId, 'setup-analyst'), before);
    }
    assert.equal((await cli('agent', 'start', configuredId, 'setup-analyst', '--fresh-history')).code, 0);
    const fresh = await json('agent', 'contexts', configuredId, 'setup-analyst'); assert.notDeepEqual(fresh, before);
    assert.equal(list(fresh).length, 1); assert.equal((await cli('stop', configuredId)).code, 0);
    assert.equal((await cli('start', configuredId, '--fresh-history')).code, 0);
    assert.notDeepEqual(await json('agent', 'contexts', configuredId, 'setup-analyst'), fresh);
    assert.deepEqual(readFileSync(bindingFile), binding, 'Explicit fresh history never changes Matrix identity or credentials');
    assert.equal(provider.requests.length, requests);
    assert.equal((await cli('stop', configuredId)).code, 0);
  });
  await scope.test('delivery, fleet messages and daemon restart retain the selected history through installed commands', async child => {
    child.after(() => { if (provider.held()) provider.finish(); });
    const histories = await json('agent', 'contexts', configuredId, 'setup-analyst'), requests = provider.requests.length;
    assert.equal(record(await json('deactivate', configuredId)).deliveryEnabled, false);
    assert.equal(record(await json('activate', configuredId)).deliveryEnabled, true);
    assert.equal((await cli('start', configuredId)).code, 0);
    await json('daemon', 'restart');
    let readinessError = '';
    try {
      await observe(async () => {
        const result = await cli('test', configuredId); readinessError = result.error.slice(-8192); return result.code === 0;
      }, 'Installed daemon restart restores its saved desired selection', 90000);
    } catch (error) {
      const result = await cli('show', configuredId);
      const current = result.code === 0 ? record(JSON.parse(result.output) as unknown) : null;
      const logs = join(root, 'logs');
      scope.diagnostic(JSON.stringify({ restartFailure: { readinessError, controllerError: result.error.slice(-8192),
        connection: current?.connection, instances: current === null ? [] : list(current.instances).map(value => {
          const instance = record(value); return { key: record(instance.instance).key, desiredActive: instance.desiredActive, phase: instance.phase, error: instance.error };
        }), logs: existsSync(logs) ? readdirSync(logs).sort().slice(-1).map(file => readFileSync(join(logs, file), 'utf8').slice(-8192)) : [] } }));
      throw error;
    }
    assert.deepEqual(await json('agent', 'contexts', configuredId, 'setup-analyst'), histories);
    assert.equal(provider.requests.length, requests);
    provider.hold(); const marker = 'Installed CLI fleet message ' + randomUUID(), messageId = randomUUID();
    const sent = await cli('message', configuredId, '--text', marker, '--message-id', messageId); assert.equal(sent.code, 0, sent.error);
    assert(sent.output.includes(messageId));
    await observe(() => provider.held() !== undefined, 'The installed CLI message reaches the actual native engine');
    assert(JSON.stringify(provider.requests.at(-1)).includes(marker)); provider.finish();
    await observe(async () => (await cli('test', configuredId)).code === 0, 'Native reply settles without changing CLI history');
    assert.deepEqual(await json('agent', 'contexts', configuredId, 'setup-analyst'), histories);
    assert.equal((await cli('stop', configuredId)).code, 0);
  });
}
