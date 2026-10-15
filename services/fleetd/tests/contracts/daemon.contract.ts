import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import { contractHttp, contractError } from '@ctlflow/crossfire-test-support/contract-http';
import { contractProcess, integer, list, observe, record, text, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import type { ContractPlatform } from '@ctlflow/crossfire-test-support/contract-platform';
import { operations } from '@ctlflow/fleetd-contracts/api';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import { operations as coordinationOperations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { Parser } from '@ctlflow/crossfire-contracts/schema/validation';
import { messageContracts } from './messages.contract.js';
import { paginationContracts } from '@ctlflow/crossfire-test-support/contract-pagination';

type Declaration = { method: string; path: string; status: number; collection: boolean; output: Parser<unknown> };
export async function daemonContracts(scope: TestContext, platform: ContractPlatform, selected: ContractTarget, runtime: 'codex' | 'pi'): Promise<void> {
  const directory = join(platform.directory, 'daemon-' + runtime); mkdirSync(directory, { mode: 0o700 }); const root = join(directory, 'controller'), home = join(directory, 'home'), fleetDirectory = join(directory, 'fleet'); mkdirSync(home, { mode: 0o700 });
  const provider = runtime === 'codex' ? await nativeProvider(scope, home) : await piProvider(scope); const binaryDirectory = join(directory, 'bin'); mkdirSync(binaryDirectory, { mode: 0o700 }); symlinkSync(piBinary(), join(binaryDirectory, 'pi')); const environment = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: binaryDirectory + delimiter + (process.env.PATH ?? '') }; const socket = join(root, 'fleetd.sock'); let daemon = contractProcess(scope, selected.daemon, ['--root', root, '--name', 'shared-contract'], directory, environment);
  const raw = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => contractHttp('http://localhost', method, path, body, headers, socket);
  async function call(operation: Declaration, parameters: Record<string, string> = {}, body?: unknown, query = '') {
    const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(parameters[key] ?? assert.fail('Missing parameter ' + key))); const response = await raw(path + query, operation.method, operation.method === 'GET' ? undefined : body ?? {}); assert.equal(response.status, operation.status, operation.path + ': ' + JSON.stringify(response.body).slice(0, 2048)); const parsed = decodeResponse(response.body, operation.output, operation.collection); assert(parsed.ok, operation.path + ': ' + (parsed.ok ? '' : parsed.error.message)); return parsed.value;
  }
  await observe(async () => { assert.equal(daemon.alive(), true, daemon.errors()); try { return (await raw('/api/status')).status === 200; } catch { return false; } }, 'Private daemon must start');
  await paginationContracts(scope, query => raw('/api/fleets' + query));
  cleanup(scope, async () => { try { await call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 }); } catch { await daemon.close(); } });
  const role = join(fleetDirectory, 'agents/analyst'); mkdirSync(role, { recursive: true, mode: 0o700 });
  const effort = runtime === 'codex' ? 'model_reasoning_effort' : 'thinking_level'; const defaults = runtime === 'codex' ? 'sandbox_mode = "read-only"\napproval_policy = "never"\n' : 'provider = "fixture"\nmodel = "fixture-model"\n';
  writeFileSync(join(role, 'agent.toml'), 'name = "Contract analyst"\nruntime = ' + JSON.stringify(runtime) + '\n[runtime_options]\n' + defaults + effort + ' = "medium"\n', { mode: 0o600 }); writeFileSync(join(role, 'AGENTS.md'), 'Only obey the authorized shared contract fixture. Use explicit tools for room replies.\n', { mode: 0o600 });
  writeFileSync(join(fleetDirectory, 'runtime.toml'), 'fleet = "shared-' + runtime + '"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n[[instances]]\nkey = "analyst"\nname = "shared-analyst-' + runtime + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/analyst"\n[instances.runtime_options]\n' + effort + ' = "high"\n', { mode: 0o600 });
  let fleetId = '', revision = 0, saved: unknown, agentId = '', matrixUserId = '', token = '';
  await scope.test('Unix transport, strict contracts and private ownership are identical', async () => {
    const status = record((await call(operations.status)).data); assert.equal(record(status.controller).name, 'shared-contract'); assert.equal(statSync(root).mode & 0o777, 0o700); assert.equal(statSync(socket).mode & 0o777, 0o600);
    contractError(await raw('/api/status', 'GET', undefined, { Origin: 'https://foreign.invalid' }), 403, 'forbidden'); contractError(await raw('/api/status', 'GET', undefined, { Host: 'foreign.invalid' }), 403, 'forbidden'); contractError(await raw('/api/status', 'GET', undefined, { Authorization: 'Bearer guessed' }), 403, 'forbidden');
    contractError(await raw('/api/fleets?page=1&page=2'), 400, 'invalid'); contractError(await raw('/api/status', 'PATCH', {}), 405, 'method_not_allowed'); assert.equal((await raw('/legacy/fleets')).status, 404);
    contractError(await raw('/api/fleets/not-a-uuid'), 400, 'invalid'); contractError(await raw('/api/operations', 'POST', { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon', fleetId: null }, expectedRevision: 0 }), 400, 'invalid');
    const added = record((await call(operations.addFleet, {}, { directory: fleetDirectory })).data); fleetId = text(added.fleetId); revision = integer(added.revision); contractError(await raw('/api/fleets/' + fleetId, 'PATCH', { expectedRevision: revision + 1, label: 'Wrong' }), 409, 'stale_revision');
    const page = await call(operations.fleets, {}, undefined, '?pageSize=1'); assert.equal(page.meta.totalItems, 1); assert.equal(list(page.data).length, 1); assert.equal((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data instanceof Array, true); assert.equal(provider.requests.length, 0, 'Inspection and contexts make no model call');
  });
  await scope.test('inspection is read-only and refuses unsafe or dangling work-area ancestors', async () => {
    const workarea = join(role, 'workarea'); assert(!existsSync(workarea), 'Inspecting an unstarted instance does not create private runtime state');
    symlinkSync(join(directory, 'missing-native-state'), workarea);
    try { contractError(await raw('/api/fleets/' + fleetId + '/agents/analyst/contexts'), 400, 'invalid'); }
    finally { unlinkSync(workarea); }
    chmodSync(role, 0o777);
    try { contractError(await raw('/api/fleets/' + fleetId + '/agents/analyst/contexts'), 400, 'invalid'); }
    finally { chmodSync(role, 0o700); }
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, []); assert.equal(provider.requests.length, 0);
  });
  async function operate(action: 'start' | 'stop' | 'reset') {
    const current = record((await call(operations.fleet, { fleetId })).data); const request = { operationId: randomUUID(), target: { kind: 'fleet', fleetId }, action, expectedRevision: integer(current.revision) }; const accepted = record((await call(operations.operate, {}, request)).data); assert.equal(accepted.operationId, request.operationId); let operation = accepted; const approvals = new Set<string>();
    await observe(async () => {
      operation = record((await call(operations.operation, { operationId: request.operationId })).data);
      if (operation.approval !== null) { const approval = record(operation.approval), url = new URL(text(approval.url)); const id = url.pathname.split('/').at(-1)!; if (!approvals.has(id)) { approvals.add(id); await platform.approve(id, text(approval.code)); } }
      assert.notEqual(operation.status, 'failed', JSON.stringify(operation.errors) + '\n' + daemon.errors()); return operation.status === 'succeeded';
    }, 'Actual native lifecycle must complete: ' + action, 90000); return operation;
  }
  await scope.test('enroll, validate exact settings and start without model housekeeping', async () => {
    await operate('start'); await observe(async () => record(record((await call(operations.fleet, { fleetId })).data).connection).connected === true, 'Fleet lease must become ready');
    const contexts = await call(operations.contexts, { fleetId, instanceKey: 'analyst' }); saved = contexts.data; assert.equal(list(saved).length, 1); assert.equal(record(list(saved)[0]).runtime, runtime); assert.equal(provider.requests.length, 0);
    const binding = JSON.parse(readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8')) as unknown; const identity = record(list(record(binding).identities)[0]); agentId = text(identity.agentId); const account = record(identity.account); matrixUserId = text(account.user_id); token = text(account.access_token);
    await observe(async () => {
      const result = await contractHttp(platform.origin, 'GET', '/api/agents/' + agentId + '/runtime-observations', undefined, { Cookie: platform.owner.cookie, Origin: platform.origin }); if (result.status !== 200) return false; const rows = list(record(result.body).data); if (!rows.length) return false; return list(record(rows[0]).settings).some(value => record(value).name === effort && record(value).effective === 'high');
    }, 'Reported effective native effort must be the instance override');
  });
  await scope.test('real native chat, steering and bounded history contracts', child => messageContracts(child, { platform, fleetDirectory, agent: { id: agentId, matrixUserId, token }, provider,
    async idle() { const file = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/listener.json'); const endpoint = record(JSON.parse(readFileSync(file, 'utf8')) as unknown); const response = await contractHttp('http://127.0.0.1:' + String(endpoint.port), 'POST', '/bindings/' + text(endpoint.binding) + '/control', { action: 'test' }, { Authorization: 'Bearer ' + text(endpoint.secret) }); return response.status === 200 && record(record(response.body).test).busy === false; },
    async delivery(enabled) { const fleet = record((await call(operations.fleet, { fleetId })).data); await call(operations.changeFleetDelivery, { fleetId }, { expectedRevision: integer(record(fleet.connection).revision), enabled }); await observe(async () => record(list(record((await call(operations.fleet, { fleetId })).data).instances)[0]).listenerActive === enabled, 'Controller applies delivery intent'); } }));
  await scope.test('stop, daemon restart and explicit resume retain history and stop intent', async () => {
    const completedRequests = provider.requests.length;
    await operate('stop'); const stopped = record((await call(operations.fleet, { fleetId })).data); assert.equal(record(list(stopped.instances)[0]).desiredActive, false); assert.equal(record(list(stopped.instances)[0]).phase, 'stopped'); assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    await call(operations.operate, {}, { operationId: randomUUID(), target: { kind: 'daemon' }, action: 'stop', expectedRevision: 0 }); await daemon.ended; daemon = contractProcess(scope, selected.daemon, ['--root', root], directory, environment);
    await observe(async () => { try { return (await raw('/api/status')).status === 200; } catch { return false; } }, 'Restarted daemon becomes ready'); const retained = record((await call(operations.fleet, { fleetId })).data); assert.equal(record(list(retained.instances)[0]).desiredActive, false); await operate('start'); assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved); assert.equal(provider.requests.length, completedRequests, 'Restart and explicit resume do not inject another model turn for finished work');
    await operate('stop');
  });
  await scope.test('management session requests reach the actual controller and retain native history', async () => {
    const binding = record(JSON.parse(readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8')) as unknown), remoteFleetId = text(binding.fleetId), before = provider.requests.length;
    async function human(operation: Declaration, input?: unknown) {
      const response = await contractHttp(platform.origin, operation.method, operation.path.replace('{fleetId}', remoteFleetId), input, { Cookie: platform.owner.cookie, Origin: platform.origin, 'X-Crossfire-CSRF': platform.owner.csrf });
      assert.equal(response.status, operation.status, JSON.stringify(response.body)); const parsed = decodeResponse(response.body, operation.output, operation.collection); assert(parsed.ok, 'Management response follows the canonical contract'); return parsed.value;
    }
    for (const action of ['start', 'stop'] as const) {
      const current = record((await human(coordinationOperations.fleet)).data); const operationId = randomUUID();
      await human(coordinationOperations.requestFleetRuntime, { operationId, agentId: null, action, expectedRevision: integer(current.revision), confirmFreshHistory: false });
      await observe(async () => {
        const rows = list((await human(coordinationOperations.fleetRuntimeOperations)).data).map(record), operation = rows.find(value => value.operationId === operationId); assert(operation, 'Management retains its requested operation');
        assert.notEqual(operation.status, 'failed', String(operation.errorMessage) + '\n' + daemon.errors()); return operation.status === 'succeeded';
      }, 'Management receives actual controller completion: ' + action, 90000);
      const state = record((await call(operations.fleet, { fleetId })).data), instance = record(list(state.instances)[0]); assert.equal(instance.desiredActive, action === 'start'); assert.equal(instance.phase, action === 'start' ? 'running' : 'stopped');
      assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    }
    assert.equal(provider.requests.length, before, 'Management lifecycle control makes no model call for finished work');
  });
}
