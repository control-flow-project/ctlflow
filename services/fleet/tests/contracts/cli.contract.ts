import assert from 'node:assert/strict';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { contractProcess, integer, list, observe, record, text, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import type { ContractPlatform } from '@ctlflow/crossfire-test-support/contract-platform';

export async function cliContracts(scope: TestContext, platform: ContractPlatform, selected: ContractTarget): Promise<void> {
  const directory = join(platform.directory, 'cli-contract'); mkdirSync(directory, { mode: 0o700 }); const root = join(directory, 'controller'), home = join(directory, 'home'), fleet = join(directory, 'fleet'); mkdirSync(home, { mode: 0o700 }); const environment = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  async function cli(...args: string[]) { const process = contractProcess(scope, selected.cli, args, directory, environment); const timer = setTimeout(() => { void process.close(); }, 30000); try { const code = await process.ended; return { code, output: process.output(), error: process.errors() }; } finally { clearTimeout(timer); await process.close(); } }
  async function json(...args: string[]) { const result = await cli(...args); assert.equal(result.code, 0, result.error); return JSON.parse(result.output) as unknown; }
  cleanup(scope, async () => { await cli('daemon', 'stop', '--root', root); });
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
}
