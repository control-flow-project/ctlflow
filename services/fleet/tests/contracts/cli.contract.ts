import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, integer, list, observe, record, text, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import type { ContractPlatform } from '@ctlflow/crossfire-test-support/contract-platform';
import { sshFixture } from './ssh-fixture.js';

export async function cliContracts(scope: TestContext, platform: ContractPlatform, selected: ContractTarget): Promise<void> {
  const directory = join(platform.directory, 'c'); mkdirSync(directory, { mode: 0o700 }); const root = join(directory, 'd'), home = join(directory, 'home'), fleet = join(directory, 'fleet'); mkdirSync(home, { mode: 0o700 }); const provider = await nativeProvider(scope, home); const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  async function cli(...args: string[]) { const process = contractProcess(scope, selected.cli, args, directory, environment); let expired = false; const timer = setTimeout(() => { expired = true; void process.close(); }, 30000); try { const code = await process.ended; assert(!expired, 'CLI must finish and detach its controller standard streams within its deadline'); return { code, output: process.output(), error: process.errors() }; } finally { clearTimeout(timer); await process.close(); } }
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
    mkdirSync(join(fleet, 'agents/analyst'), { recursive: true, mode: 0o700 }); writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "cli-research"\ninstances = []\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n', { mode: 0o600 }); writeFileSync(join(fleet, 'agents/analyst/agent.toml'), 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\nsandbox_mode = "read-only"\napproval_policy = "never"\n', { mode: 0o600 }); writeFileSync(join(fleet, 'agents/analyst/AGENTS.md'), 'Retain this authored role.\n', { mode: 0o600 });
    const added = record(await json('add', fleet)); const id = text(added.fleetId); assert.equal(list(await json('list')).length, 1); const expanded = record(await json('agent', 'add', 'cli-research', 'analyst', '--definition', 'analyst')); assert(integer(expanded.revision) > integer(added.revision)); assert.equal(list(await json('agent', 'list', id)).length, 1); assert.deepEqual(await json('agent', 'contexts', id, 'analyst'), []); assert.notEqual((await cli('agent', 'attach', id, 'analyst')).code, 0);
    await json('agent', 'remove', id, 'analyst'); await json('remove', id); assert.equal(list(await json('list')).length, 0); assert.notEqual((await cli('list', '--fresh-history')).code, 0); assert.notEqual((await cli('list', '--root', root, '--remote', 'other')).code, 0);
  });
  await scope.test('CLI daemon shutdown is resumable without installing a host service', async () => {
    await json('daemon', 'stop'); await observe(async () => { try { await contractHttp('http://localhost', 'GET', '/api/status', undefined, {}, join(root, 'fleetd.sock')); return false; } catch { return true; } }, 'Daemon must finish stopping');
    const restarted = record(await json('daemon', 'start')); assert.equal(record(restarted.controller).name, 'cli-contract'); assert.equal(list(await json('list')).length, 0);
  });
  await scope.test('actual SSH forwards the same private API and rejects an untrusted host', async child => {
    const ssh = await sshFixture(child), previous = environment.PATH; environment.PATH = ssh.bin + delimiter + (previous ?? '');
    try {
      await json('remote', 'add', 'verified-remote', '--ssh', 'fixture', '--root', root);
      assert.deepEqual(await json('list', '--remote', 'verified-remote'), []);
      ssh.distrust(); assert.notEqual((await cli('list', '--remote', 'verified-remote')).code, 0, 'Wrong SSH host keys never receive implicit trust');
      assert.equal(record(record(await json('daemon', 'status')).controller).name, 'cli-contract', 'Tunnel teardown never stops its remote controller');
    } finally { if (previous === undefined) delete environment.PATH; else environment.PATH = previous; }
  });
  await scope.test('noninteractive setup completes real enrollment and preserves history and explicit stop on repetition', async () => {
    const configured = join(directory, 'configured'), role = join(configured, 'agents/analyst'); mkdirSync(role, { recursive: true, mode: 0o700 });
    writeFileSync(join(role, 'agent.toml'), 'name = "Setup analyst"\nruntime = "codex"\n[runtime_options]\nsandbox_mode = "read-only"\napproval_policy = "never"\nmodel_reasoning_effort = "high"\n', { mode: 0o600 }); writeFileSync(join(role, 'AGENTS.md'), 'Setup makes no model prompt. Preserve identity and existing history.\n', { mode: 0o600 });
    const configuration = join(configured, 'runtime.toml'); writeFileSync(configuration, 'fleet = "setup-contract"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n[[instances]]\nkey = "setup-analyst"\nname = "setup-analyst"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/setup-analyst"\n', { mode: 0o600 });
    const starting = contractProcess(scope, selected.cli, ['setup', '--config', configuration], directory, environment); const approved = new Set<string>();
    try {
      await observe(async () => {
        assert(starting.alive() || starting.child.exitCode === 0, starting.errors() + '\n' + starting.output());
        const operationId = /"operationId"\s*:\s*"([a-f0-9-]{36})"/u.exec(starting.output())?.[1];
        if (operationId) {
          const response = await contractHttp('http://localhost', 'GET', '/api/operations/' + operationId, undefined, {}, join(root, 'fleetd.sock')); assert.equal(response.status, 200); const operation = record(record(response.body).data);
          if (operation.approval !== null) { const approval = record(operation.approval), id = new URL(text(approval.url)).pathname.split('/').at(-1)!; if (!approved.has(id)) { approved.add(id); await platform.approve(id, text(approval.code)); } }
        }
        return starting.child.exitCode === 0;
      }, 'Setup finishes without stdin prompts after explicit human enrollment approval', 90000);
      assert.equal(await starting.ended, 0); assert.match(starting.output(), /"status"\s*:\s*"ready"/u); assert.equal(approved.size, 1);
    } finally { await starting.close(); }
    const fleets = list(await json('list')); assert.equal(fleets.length, 1); const id = text(record(fleets[0]).fleetId); const histories = await json('agent', 'contexts', id, 'setup-analyst'); assert.equal(list(histories).length, 1);
    const repeated = await cli('setup'); assert.equal(repeated.code, 0, repeated.error); assert.match(repeated.output, /"status"\s*:\s*"ready"/u); assert.deepEqual(await json('agent', 'contexts', id, 'setup-analyst'), histories);
    const stopped = await cli('stop', id); assert.equal(stopped.code, 0, stopped.error); const retained = await cli('setup'); assert.equal(retained.code, 0, retained.error); assert.match(retained.output, /"status"\s*:\s*"stopped"/u);
    assert.deepEqual(await json('agent', 'contexts', id, 'setup-analyst'), histories); assert.equal(provider.requests.length, 0, 'Initial/repeated setup never performs model housekeeping or a fresh-history reset');
  });
}
