import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
import { lastUser, messageContracts } from './messages.contract.js';
import { paginationContracts } from '@ctlflow/crossfire-test-support/contract-pagination';
import { readAuthentication } from '@ctlflow/fleetd-storage/authentication';
import { roomContext } from '@ctlflow/crossfire-kernel/history-context';
import { authenticationContracts } from './authentication.contract.js';

type Declaration = { method: string; path: string; status: number; collection: boolean; output: Parser<unknown> };
export async function daemonContracts(scope: TestContext, platform: ContractPlatform, selected: ContractTarget, runtime: 'codex' | 'pi'): Promise<void> {
  const directory = join(platform.directory, 'd-' + runtime); mkdirSync(directory, { mode: 0o700 }); const root = join(directory, 'c'), home = join(directory, 'home'), fleetDirectory = join(directory, 'fleet'); mkdirSync(home, { mode: 0o700 });
  const provider = runtime === 'codex' ? await nativeProvider(scope, home) : await piProvider(scope); const binaryDirectory = join(directory, 'bin'); mkdirSync(binaryDirectory, { mode: 0o700 }); symlinkSync(piBinary(), join(binaryDirectory, 'pi')); const environment = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: binaryDirectory + delimiter + (process.env.PATH ?? '') }; const socket = join(root, 'fleetd.sock'); let daemon = contractProcess(scope, selected.daemon, ['--root', root, '--name', 'shared-contract'], directory, environment);
  const authenticationFile = join(environment.XDG_CONFIG_HOME, 'ctlflow/fleetd.json');
  const successful = new Set<string>(), unsupported = new Set<string>();
  const raw = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => contractHttp('http://localhost', method, path, body, { Authorization: 'Bearer ' + readAuthentication(authenticationFile), ...headers }, socket);
  async function call(operation: Declaration, parameters: Record<string, string> = {}, body?: unknown, query = '') {
    const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(parameters[key] ?? assert.fail('Missing parameter ' + key))); const response = await raw(path + query, operation.method, operation.method === 'GET' ? undefined : body ?? {}); assert.equal(response.status, operation.status, operation.path + ': ' + JSON.stringify(response.body).slice(0, 2048)); const parsed = decodeResponse(response.body, operation.output, operation.collection); assert(parsed.ok, operation.path + ': ' + (parsed.ok ? '' : parsed.error.message)); successful.add(operation.method + ' ' + operation.path); return parsed.value;
  }
  await observe(async () => { assert.equal(daemon.alive(), true, daemon.errors()); try { return (await raw('/api/status')).status === 200; } catch { return false; } }, 'Private daemon must start');
  await authenticationContracts(scope, socket, authenticationFile);
  await paginationContracts(scope, query => raw('/api/fleets' + query));
  cleanup(scope, async () => { try { await call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 }); } catch { await daemon.close(); } });
  const role = join(fleetDirectory, 'agents/analyst'); mkdirSync(role, { recursive: true, mode: 0o700 });
  const effort = runtime === 'codex' ? 'model_reasoning_effort' : 'thinking_level'; const defaults = runtime === 'codex' ? 'sandbox_mode = "read-only"\napproval_policy = "never"\nfeatures = { default_mode_request_user_input = true }\n' : 'provider = "fixture"\nmodel = "fixture-model"\n';
  writeFileSync(join(role, 'agent.toml'), 'name = "Contract analyst"\nruntime = ' + JSON.stringify(runtime) + '\n[runtime_options]\n' + defaults + effort + ' = "medium"\n', { mode: 0o600 }); writeFileSync(join(role, 'AGENTS.md'), 'Only obey the authorized shared contract fixture. Use explicit tools for room replies.\n', { mode: 0o600 });
  const runtimeSource = 'fleet = "shared-' + runtime + '"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.backendUserId) + '\n[[instances]]\nkey = "analyst"\nname = "shared-analyst-' + runtime + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/analyst"\n[instances.runtime_options]\n' + effort + ' = "high"\n';
  writeFileSync(join(fleetDirectory, 'runtime.toml'), runtimeSource, { mode: 0o600 });
  let fleetId = '', revision = 0, saved: unknown, agentId = '', backendUserId = '', token = '';
  async function delivery(enabled: boolean): Promise<void> {
    const fleet = record((await call(operations.fleet, { fleetId })).data);
    await call(operations.changeFleetDelivery, { fleetId }, { expectedRevision: integer(record(fleet.connection).revision), enabled });
    await observe(async () => record(list(record((await call(operations.fleet, { fleetId })).data).instances)[0]).listenerActive === enabled, 'Controller applies delivery intent');
  }
  let nativeInspection: unknown = null;
  async function idle(): Promise<boolean> {
    const file = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/listener.json');
    const endpoint = record(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    const response = await contractHttp('http://127.0.0.1:' + String(endpoint.port), 'POST', '/bindings/' + text(endpoint.binding) + '/control',
      { action: 'test' }, { Authorization: 'Bearer ' + text(endpoint.secret) });
    nativeInspection = { status: response.status, body: response.body };
    return response.status === 200 && record(record(response.body).test).busy === false;
  }
  function publications() {
    const home = join(fleetDirectory, 'agents/analyst/workarea/analyst', runtime === 'pi' ? '.pi/receipts' : '.codex');
    return readdirSync(home).filter(name => runtime === 'pi' ? name.endsWith('.json') : name.endsWith('.receipt')).map(name => {
      const journal = record(JSON.parse(readFileSync(join(home, name), 'utf8')) as unknown);
      return { file: name, sessionId: journal.sessionId, pending: journal.pending === null ? null : record(journal.pending).messageId,
        confirmed: list(journal.confirmed).map(value => record(value).messageId) };
    });
  }
  await scope.test('Unix transport, strict contracts and private ownership are identical', async () => {
    const status = record((await call(operations.status)).data); assert.equal(record(status.controller).name, 'shared-contract'); assert.equal(statSync(root).mode & 0o777, 0o700); assert.equal(statSync(socket).mode & 0o777, 0o600);
    contractError(await raw('/api/status', 'GET', undefined, { Origin: 'https://foreign.invalid' }), 403, 'forbidden'); contractError(await raw('/api/status', 'GET', undefined, { Host: 'foreign.invalid' }), 403, 'forbidden'); contractError(await raw('/api/status', 'GET', undefined, { Authorization: 'Bearer guessed' }), 401, 'unauthorized');
    contractError(await raw('/api/fleets?page=1&page=2'), 400, 'invalid'); contractError(await raw('/api/status', 'PATCH', {}), 405, 'method_not_allowed'); assert.equal((await raw('/legacy/fleets')).status, 404);
    contractError(await raw('/api/fleets/not-a-uuid'), 400, 'invalid'); contractError(await raw('/api/operations', 'POST', { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon', fleetId: null }, expectedRevision: 0 }), 400, 'invalid');
    const added = record((await call(operations.addFleet, {}, { directory: fleetDirectory })).data); fleetId = text(added.fleetId); revision = integer(added.revision); contractError(await raw('/api/fleets/' + fleetId, 'PATCH', { expectedRevision: revision + 1, label: 'Wrong' }), 409, 'stale_revision');
    const page = await call(operations.fleets, {}, undefined, '?pageSize=1'); assert.equal(page.meta.totalItems, 1); assert.equal(list(page.data).length, 1); assert.equal((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data instanceof Array, true); assert.equal(provider.requests.length, 0, 'Inspection and contexts make no model call');
  });
  await scope.test('fleet labels retain canonical Unicode and UTF-16 length limits', async () => {
    let current = record((await call(operations.fleet, { fleetId })).data);
    const exact = '😀'.repeat(50);
    current = record((await call(operations.changeFleet, { fleetId }, { expectedRevision: integer(current.revision), label: exact })).data);
    assert.equal(current.label, exact);
    contractError(await raw('/api/fleets/' + fleetId, 'PATCH', { expectedRevision: integer(current.revision), label: exact + '😀' }), 400, 'invalid');
    current = record((await call(operations.changeFleet, { fleetId }, { expectedRevision: integer(current.revision), label: 'Valid\u0080label' })).data);
    assert.equal(current.label, 'Valid\u0080label');
    revision = integer(current.revision);
    assert.equal(provider.requests.length, 0);
  });
  await scope.test('diagnostics collect scoped findings without native startup, configuration writes or leaking private state', async () => {
    const before = readFileSync(join(root, 'fleets.json')), authentication = readFileSync(authenticationFile);
    const report = record((await call(operations.diagnostics)).data), checks = list(report.checks).map(record);
    assert.deepEqual(checks.map(check => check.id).sort(), ['controller.connection', 'controller.lifecycle', 'controller.logging']);
    assert(checks.every(check => check.status === 'pass'));
    const scoped = record((await call(operations.diagnostics, {}, undefined, '?fleetId=' + fleetId)).data);
    const agentChecks = list(scoped.checks).map(record).filter(check => record(check.scope).instanceKey === 'analyst');
    assert.equal(agentChecks.length, 7);
    assert.equal(agentChecks.find(check => check.id === 'agent.activation')?.message, 'Agent is not selected for activation');
    assert.equal(agentChecks.find(check => check.id === 'agent.provider')?.status, 'not-applicable');
    assert.equal(agentChecks.find(check => check.id === 'agent.native')?.message, 'Native state: stopped');
    assert.equal(record(scoped.scope).fleetId, fleetId);
    await call(operations.diagnostics, {}, undefined, '?fleetId=' + fleetId + '&instanceKey=analyst');
    for (const query of ['?fleetId=invalid', '?instanceKey=analyst', '?fleetId=' + fleetId + '&fleetId=' + fleetId, '?fleetId=' + fleetId + '&instanceKey=analyst&instanceKey=analyst', '?unknown=1'])
      contractError(await raw('/api/diagnostics' + query), 400, 'invalid');
    contractError(await raw('/api/diagnostics?fleetId=' + randomUUID()), 404, 'missing');
    contractError(await raw('/api/diagnostics?fleetId=' + fleetId + '&instanceKey=absent'), 404, 'missing');
    contractError(await raw('/api/diagnostics', 'GET', undefined, { Authorization: 'Bearer guessed' }), 401, 'unauthorized');
    assert.deepEqual(readFileSync(join(root, 'fleets.json')), before);
    assert.deepEqual(readFileSync(authenticationFile), authentication);
    assert.equal(existsSync(join(role, 'workarea')), false);
    assert.equal(provider.requests.length, 0);
    const serialized = JSON.stringify(scoped);
    for (const secret of [home, fleetDirectory, readAuthentication(authenticationFile)]) assert(!serialized.includes(secret), 'Diagnostics omit paths and credentials');
  });
  await scope.test('stopped roster mutations are revision-qualified, bounded and preserve authored roles', async () => {
    const authored = readFileSync(join(role, 'AGENTS.md'));
    const reviewer = join(fleetDirectory, 'agents/reviewer'); mkdirSync(reviewer, { mode: 0o700 });
    writeFileSync(join(reviewer, 'agent.toml'), readFileSync(join(role, 'agent.toml')), { mode: 0o600 });
    writeFileSync(join(reviewer, 'AGENTS.md'), 'An alternate authored role.\n', { mode: 0o600 });
    let current = record((await call(operations.fleet, { fleetId })).data);
    const extra = { key: 'temporary', name: 'temporary-' + runtime, definition: 'analyst', workarea: 'agents/analyst/workarea/temporary', listenerOptions: { mirrorOutput: false } };
    const unchanged = readFileSync(join(fleetDirectory, 'runtime.toml'));
    for (const mirrorOutput of [null, 'false', 0, [], {}]) {
      contractError(await raw('/api/fleets/' + fleetId + '/agents', 'POST', { expectedRevision: integer(current.revision), instance: { ...extra, listenerOptions: { mirrorOutput } } }), 400, 'invalid');
      assert.deepEqual(readFileSync(join(fleetDirectory, 'runtime.toml')), unchanged, 'Invalid presentation settings cannot mutate the roster');
    }
    current = record((await call(operations.addAgent, { fleetId }, { expectedRevision: integer(current.revision), instance: extra })).data);
    const registered = await call(operations.agents, { fleetId }, undefined, '?pageSize=1');
    assert.equal(registered.meta.totalItems, 2); assert.equal(list(registered.data).length, 1);
    assert.equal(record(record((await call(operations.agent, { fleetId, instanceKey: extra.key })).data).instance).name, extra.name);
    assert.equal(record(record(record((await call(operations.agent, { fleetId, instanceKey: extra.key })).data).instance).listenerOptions).mirrorOutput, false, 'JSON configuration survives TOML persistence and reloading');
    const bytes = readFileSync(join(fleetDirectory, 'runtime.toml'));
    contractError(await raw('/api/fleets/' + fleetId + '/agents', 'POST', { expectedRevision: integer(current.revision) - 1, instance: extra }), 409, 'stale_revision');
    for (const duplicate of [extra, { ...extra, name: 'different-' + runtime }, { ...extra, key: 'another', workarea: 'agents/analyst/workarea/another' }]) {
      contractError(await raw('/api/fleets/' + fleetId + '/agents', 'POST', { expectedRevision: integer(current.revision), instance: duplicate }), 409, 'name_collision');
    }
    assert.deepEqual(readFileSync(join(fleetDirectory, 'runtime.toml')), bytes);
    current = record((await call(operations.changeAgent, { fleetId, instanceKey: extra.key }, { expectedRevision: integer(current.revision), definition: 'reviewer' })).data);
    assert.equal(record(record(list(current.instances).find(value => record(record(value).instance).key === extra.key)).instance).definition, 'reviewer');
    assert.equal(record(record(record((await call(operations.agent, { fleetId, instanceKey: extra.key })).data).instance).listenerOptions).mirrorOutput, false, 'An unrelated role update retains the explicit quiet selection');
    current = record((await call(operations.removeAgent, { fleetId, instanceKey: extra.key }, { expectedRevision: integer(current.revision) })).data);
    revision = integer(current.revision); assert.equal(list(current.instances).length, 1);
    assert.deepEqual(readFileSync(join(role, 'AGENTS.md')), authored);
    assert.equal(existsSync(join(role, 'workarea')), false, 'Roster inspection and edits never create native state');
    assert.equal(provider.requests.length, 0);
  });
  await scope.test('every daemon operation rejects unknown query fields before effects', async () => {
    const before = readFileSync(join(root, 'fleets.json')), current = record((await call(operations.fleet, { fleetId })).data);
    const response = await contractHttp(platform.origin, 'GET', '/onboarding/setup.json?ownerBackendUserId=' + encodeURIComponent(platform.owner.backendUserId), undefined, { Cookie: platform.owner.cookie });
    assert.equal(response.status, 200); const descriptor = record(response.body), expectedRevision = integer(current.revision);
    const inputs: Record<string, unknown> = {
      setup: { descriptor, workspace: fleetDirectory, configuration: join(fleetDirectory, 'runtime.toml') },
      addFleet: { directory: fleetDirectory }, changeFleet: { expectedRevision, label: 'Must not change' }, removeFleet: { expectedRevision },
      changeFleetDelivery: { expectedRevision: 0, enabled: false }, createFleetMessage: { messageId: randomUUID(), body: 'Must not reach native input' },
      addAgent: { expectedRevision, instance: { key: 'forbidden', name: 'forbidden', definition: 'analyst', workarea: 'agents/analyst/workarea/forbidden' } },
      changeAgent: { expectedRevision, definition: 'reviewer' }, removeAgent: { expectedRevision },
      operate: { operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId }, expectedRevision },
    };
    for (const [name, operation] of Object.entries(operations)) {
      const parameters: Record<string, string> = { fleetId, instanceKey: 'analyst', operationId: randomUUID() };
      const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(parameters[key]!));
      contractError(await raw(path + '?__unexpected=1', operation.method, operation.method === 'GET' ? undefined : inputs[name] ?? {}), 400, 'invalid');
      if (operation.method !== 'GET') contractError(await raw(path, operation.method, { ...record(inputs[name] ?? {}), __unexpected: true }), 400, 'invalid');
    }
    assert.deepEqual(readFileSync(join(root, 'fleets.json')), before);
    assert.equal(existsSync(join(root, 'setups.json')), false, 'Rejected setup cannot create its persistent authority record');
    assert.equal(provider.requests.length, 0);
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
  async function operate(action: 'enroll' | 'start' | 'stop' | 'reset' | 'update', instanceKey?: string) {
    const current = record((await call(operations.fleet, { fleetId })).data); const request = { operationId: randomUUID(), target: instanceKey ? { kind: 'agent', fleetId, instanceKey } : { kind: 'fleet', fleetId }, action, expectedRevision: integer(current.revision), ...(action === 'update' ? { releaseDirectory: platform.releaseDirectory } : {}) }; const accepted = record((await call(operations.operate, {}, request)).data); assert.equal(accepted.operationId, request.operationId); let operation = accepted; const approvals = new Set<string>();
    await observe(async () => {
      operation = record((await call(operations.operation, { operationId: request.operationId })).data);
      if (operation.approval !== null) { const approval = record(operation.approval), url = new URL(text(approval.url)); const id = url.pathname.split('/').at(-1)!; if (!approvals.has(id)) { approvals.add(id); await platform.approve(id, text(approval.code)); } }
      assert.notEqual(operation.status, 'failed', JSON.stringify(operation.errors) + '\n' + daemon.errors()); return operation.status === 'succeeded';
    }, 'Actual native lifecycle must complete: ' + action, 90000); return operation;
  }
  await scope.test('enrollment alone obtains native identities without starting sessions or model work', async () => {
    await operate('enroll');
    const current = record((await call(operations.fleet, { fleetId })).data), instance = record(list(current.instances)[0]);
    assert.equal(instance.desiredActive, false); assert.equal(instance.listenerActive, false);
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, []);
    assert.equal(provider.requests.length, 0);
  });
  await scope.test('enroll, validate exact settings and start without model housekeeping', async () => {
    await operate('start'); await observe(async () => record(record((await call(operations.fleet, { fleetId })).data).connection).connected === true, 'Fleet lease must become ready');
    const contexts = await call(operations.contexts, { fleetId, instanceKey: 'analyst' }); saved = contexts.data; assert.equal(list(saved).length, 1); assert.equal(record(list(saved)[0]).runtime, runtime); assert.equal(provider.requests.length, 0);
    const binding = JSON.parse(readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8')) as unknown; const identity = record(list(record(binding).identities)[0]); agentId = text(identity.agentId); const account = record(identity.account); backendUserId = text(account.userId); token = text(account.accessToken);
    await observe(async () => {
      const result = await contractHttp(platform.origin, 'GET', '/api/agents/' + agentId + '/runtime-observations', undefined, { Cookie: platform.owner.cookie, Origin: platform.origin }); if (result.status !== 200) return false; const rows = list(record(result.body).data); if (!rows.length) return false; return list(record(rows[0]).settings).some(value => record(value).name === effort && record(value).effective === 'high');
    }, 'Reported effective native effort must be the instance override');
  });
  await scope.test('readiness and attachment inspect the existing native writer without creating another session', async () => {
    const count = provider.requests.length;
    assert.equal(record((await call(operations.readiness, { fleetId })).data).accepted, true);
    const path = '/api/fleets/' + fleetId + '/agents/analyst/attachment';
    if (runtime === 'pi') {
      contractError(await raw(path), 503, 'unavailable');
      unsupported.add(operations.attachment.method + ' ' + operations.attachment.path);
    } else {
      const pointer = record((await call(operations.attachment, { fleetId, instanceKey: 'analyst' })).data);
      assert.equal(pointer.runtime, runtime); assert.equal(pointer.sessionId, record(list(saved)[0]).sessionId);
      const connection = record(pointer.connection); assert(new URL(text(connection.endpoint)).hostname === '127.0.0.1');
      assert.equal(statSync(text(connection.tokenFile)).mode & 0o777, 0o600);
    }
    for (const query of ['?unknown=1', '?context=shared&context=shared']) contractError(await raw(path + query), 400, 'invalid');
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    assert.equal(provider.requests.length, count);
  });
  await scope.test('diagnostics inspect the existing provider without refresh, inference, or native history changes', async () => {
    const count = provider.requests.length, before = publications(), binding = readFileSync(join(fleetDirectory, '.fleet/binding.json'));
    const report = record((await call(operations.diagnostics, {}, undefined, '?fleetId=' + fleetId + '&instanceKey=analyst')).data);
    const checks = list(report.checks).map(record), native = checks.find(check => check.id === 'agent.native'), providerCheck = checks.find(check => check.id === 'agent.provider');
    assert(native && providerCheck);
    assert.equal(native.status, 'pass'); assert.equal(native.message, 'Native state: idle');
    assert.equal(providerCheck.status, runtime === 'pi' ? 'pass' : 'not-applicable');
    assert.equal(typeof providerCheck.observedAt, 'number');
    assert.equal(provider.requests.length, count, 'Provider metadata inspection never invokes the model');
    assert.deepEqual(publications(), before);
    assert.deepEqual(readFileSync(join(fleetDirectory, '.fleet/binding.json')), binding);
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
  });
  await scope.test('an idle controller killed without shutdown restores the desired selection and exact history', async () => {
    const authentication = readFileSync(authenticationFile), count = provider.requests.length;
    assert.equal(daemon.child.kill('SIGKILL'), true); await daemon.ended;
    daemon = contractProcess(scope, selected.daemon, ['--root', root], directory, environment);
    await observe(async () => { assert(daemon.alive(), daemon.errors()); try { return (await raw('/api/fleets/' + fleetId + '/readiness')).status === 200; } catch { return false; } }, 'Crash recovery must restore an enabled listener without creating a new history', 90000);
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    assert.deepEqual(readFileSync(authenticationFile), authentication);
    assert.equal(record(list(record((await call(operations.fleet, { fleetId })).data).instances)[0]).desiredActive, true);
    assert.equal(provider.requests.length, count, 'Completed or idle work does not need a continuation model turn');
  });
  await scope.test('an upstream server outage closes delivery but cannot terminate the controller or replace history', async () => {
    const count = provider.requests.length;
    await platform.close();
    try {
      await observe(async () => {
        assert.equal(daemon.alive(), true, daemon.errors());
        return record(record((await call(operations.fleet, { fleetId })).data).connection).connected === false;
      }, 'The controller stays observable while unavailable upstream admission closes', 20000);
      assert.equal(record((await call(operations.status)).data).stopping, false);
    } finally { await platform.restart(selected); }
    await observe(async () => {
      assert.equal(daemon.alive(), true, daemon.errors());
      return (await raw('/api/fleets/' + fleetId + '/readiness')).status === 200;
    }, 'The same controller reconnects after the upstream server returns', 90000);
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    assert.equal(provider.requests.length, count, 'A network outage must not create housekeeping model work');
  });
  await scope.test('real native chat, steering and bounded history contracts', child => messageContracts(child, { platform, fleetDirectory, agent: { id: agentId, backendUserId, token }, provider,
    idle,
    delivery }));
  await scope.test('an actual native question waits for explicit owner submission and returns only to its original history', async () => {
    const requests = provider.requests.length, choice = 'Reviewed choice ' + randomUUID();
    provider.tool(runtime === 'codex' ? 'request_user_input' : 'crossfire_question', runtime === 'codex'
      ? { questions: [{ id: 'destination', header: 'Destination', question: 'Choose the reviewed destination.', options: [
        { label: 'Do not proceed', description: 'Wait for review' }, { label: choice, description: 'The reviewed destination' }] }] }
      : { title: 'Destination', prompt: 'Choose the reviewed destination.', options: ['Do not proceed', choice] });
    await call(operations.createFleetMessage, { fleetId }, { messageId: randomUUID(), body: 'Ask the owner to select the reviewed destination.' });
    const base = '/api/agents/' + agentId + '/runtime-decisions';
    const headers = { Cookie: platform.owner.cookie, Origin: platform.origin, 'X-Crossfire-CSRF': platform.owner.csrf };
    async function decision(path: string, method = 'GET', body?: unknown) {
      const response = await contractHttp(platform.origin, method, path, body, headers);
      assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 2048));
      return record(response.body).data;
    }
    let pending: Record<string, unknown> | undefined;
    await observe(async () => {
      pending = list(await decision(base)).map(record).find(value => value.status === 'pending');
      return pending !== undefined;
    }, 'The actual native question is published as an owner decision', 30000);
    assert(pending);
    const path = base + '/' + text(pending.id), view = record(await decision(path));
    assert.equal(view.sessionId, record(list(saved)[0]).sessionId);
    assert.equal(view.runtime, runtime); assert.equal(view.kind, 'question'); assert.equal(view.status, 'pending');
    const question = record(list(view.questions)[0]), selectedChoice = list(question.options).map(record).find(value => value.label === choice);
    assert(selectedChoice, 'Review retains the exact choices offered by the native question');
    assert.equal(record(await decision(path)).status, 'pending', 'Opening the review is never an answer');
    assert.equal(provider.requests.length, requests + 1, 'The native engine remains waiting without a routing model call');
    assert.equal(daemon.alive(), true, daemon.errors());
    const refused = await contractHttp(platform.origin, 'POST', path + '/answer', { answers: [
      { questionId: question.id, optionId: selectedChoice.id, text: null }] }, { Authorization: 'Bearer ' + token });
    contractError(refused, 401, 'unauthorized');
    assert.equal(record(await decision(path)).status, 'pending');
    await decision(path + '/answer', 'POST', { answers: [{ questionId: question.id, optionId: selectedChoice.id, text: null }] });
    await observe(async () => record(await decision(path)).status === 'responded', 'The listener confirms the exact answer reached the original native request', 30000);
    await observe(async () => (await raw('/api/fleets/' + fleetId + '/readiness')).status === 200, 'The answered native question leaves the same listener ready');
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    assert.equal(provider.requests.length, requests + 2, 'Only the actual native tool continuation performs another model request');
    const reply = record(provider.requests.at(-1)), outputs = list(reply.input ?? reply.messages).map(record);
    assert(outputs.some(value => (value.type === 'function_call_output' || value.role === 'tool')
      && JSON.stringify(value.output ?? value.content).includes(choice)), 'The selected answer reaches the native tool output, not just the preceding question text');
  });
  await scope.test('paused delivery retains pending owner decisions and reports new native questions without admitting chat', async child => {
    const requests = provider.requests.length, base = '/api/agents/' + agentId + '/runtime-decisions';
    const headers = { Cookie: platform.owner.cookie, Origin: platform.origin, 'X-Crossfire-CSRF': platform.owner.csrf };
    async function decision(path: string, method = 'GET', body?: unknown) {
      const response = await contractHttp(platform.origin, method, path, body, headers);
      assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 2048));
      return record(response.body).data;
    }
    function question(id: string): void {
      provider.tool(runtime === 'codex' ? 'request_user_input' : 'crossfire_question', runtime === 'codex'
        ? { questions: [{ id, header: 'Review', question: 'Review this native request.', options: [
          { label: 'Wait', description: 'Do not proceed' }, { label: id, description: 'Explicit reviewed choice' }] }] }
        : { title: 'Review', prompt: 'Review this native request.', options: ['Wait', id] });
    }
    async function pending(excluded?: string): Promise<Record<string, unknown>> {
      let selected: Record<string, unknown> | undefined;
      await observe(async () => {
        selected = list(await decision(base)).map(record).find(value => value.status === 'pending' && value.id !== excluded);
        return selected !== undefined;
      }, 'Native questions remain reportable while new chat admission is paused', 30000);
      assert(selected); return record(await decision(base + '/' + text(selected.id)));
    }
    async function answer(view: Record<string, unknown>, choice: string): Promise<void> {
      const offered = record(list(view.questions)[0]), selected = list(offered.options).map(record).find(option => option.label === choice);
      assert(selected); const path = base + '/' + text(view.id);
      await decision(path + '/answer', 'POST', { answers: [{ questionId: offered.id, optionId: selected.id, text: null }] });
      await observe(async () => record(await decision(path)).status === 'responded', 'The exact native answer is acknowledged while chat stays paused', 30000);
    }
    const first = 'Before pause ' + randomUUID(), second = 'During pause ' + randomUUID();
    question(first);
    await call(operations.createFleetMessage, { fleetId }, { messageId: randomUUID(), body: 'Ask two reviewed owner questions.' });
    const original = await pending();
    try {
      await delivery(false);
      assert.equal(record(await decision(base + '/' + text(original.id))).status, 'pending', 'Pausing chat must not expire a running native decision');
      const diagnosis = record((await call(operations.diagnostics, {}, undefined, '?fleetId=' + fleetId + '&instanceKey=analyst')).data);
      const checks = list(diagnosis.checks).map(record);
      assert.equal(checks.find(check => check.id === 'agent.listener')?.message, 'Listener delivery is deliberately paused');
      assert(checks.every(check => check.status !== 'fail'), 'Paused delivery and an owner decision are not native failures');
      assert.equal(provider.requests.length, requests + 1, 'Read-only diagnosis does not answer or continue the pending question');
      question(second); await answer(original, first);
      const next = await pending(text(original.id));
      assert.equal(next.sessionId, original.sessionId); assert.equal(next.runId, original.runId, 'Pausing delivery preserves reporting ownership');
      await answer(next, second);
      assert.equal(record(record((await call(operations.fleet, { fleetId })).data).connection).deliveryEnabled, false);
      assert.equal(record(list(record((await call(operations.fleet, { fleetId })).data).instances)[0]).listenerActive, false);
      assert.equal(provider.requests.length, requests + 3, 'Only the two native tool continuations run while chat is paused');
      assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    } catch (error) {
      try {
        const listeners = await contractHttp(platform.origin, 'GET', '/api/agents/' + agentId + '/listener-runs', undefined, headers);
        child.diagnostic(JSON.stringify({ decision: await decision(base + '/' + text(original.id)), listeners: listeners.body,
          fleet: (await raw('/api/fleets/' + fleetId)).body, errors: daemon.errors().slice(-4096) }).slice(0, 12288));
      } catch (diagnosticError) { child.diagnostic(String(diagnosticError).slice(0, 1024)); }
      throw error;
    } finally { await delivery(true); }
  });
  await scope.test('repeated crashes during held native responses resume the same history and unfinished request', async child => {
    child.after(() => { if (provider.held()) provider.finish(); });
    const marker = 'Resume this unfinished fleet request ' + randomUUID();
    provider.hold();
    await call(operations.createFleetMessage, { fleetId }, { messageId: randomUUID(), body: marker });
    await observe(() => provider.held() !== undefined, 'Fleet broadcast reaches the actual native engine');
    assert(lastUser(provider.requests.at(-1)).includes(marker));
    const requestsBeforeDiagnosis = provider.requests.length;
    let nativeCheck: Record<string, unknown> | undefined;
    await observe(async () => {
      const diagnostic = record((await call(operations.diagnostics, {}, undefined, '?fleetId=' + fleetId + '&instanceKey=analyst')).data);
      nativeCheck = list(diagnostic.checks).map(record).find(check => check.id === 'agent.native');
      return nativeCheck?.message === 'Native state: working';
    }, 'The actual working notification reaches the read-only diagnostic snapshot');
    assert.equal(nativeCheck?.status, 'pass'); assert.equal(nativeCheck?.message, 'Native state: working');
    assert.equal(provider.requests.length, requestsBeforeDiagnosis, 'Diagnosing working agents cannot interrupt or submit work');
    const checkpoint = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/resume-work.json');
    try {
      for (let restart = 0; restart < 2; restart++) {
        const beforeCrash = readFileSync(checkpoint, 'utf8'), before = provider.requests.length, original = provider.held()!;
        assert.equal(list(JSON.parse(beforeCrash) as unknown).length, 1, 'Unfinished work is durable before the actual provider request can be observed');
        provider.hold(); assert.equal(daemon.child.kill('SIGKILL'), true); await daemon.ended;
        await observe(() => original.destroyed, 'A dead controller leaves no native writer holding the old provider response');
        daemon = contractProcess(scope, selected.daemon, ['--root', root], directory, environment);
        try { await observe(() => provider.requests.length >= before + 1 && provider.held() !== undefined, 'Restart resumes the unfinished request rather than silently dropping it', 90000); }
        catch (error) {
          child.diagnostic(JSON.stringify({ restart, beforeCrash, afterRestart: existsSync(checkpoint) ? readFileSync(checkpoint, 'utf8') : null,
            fleet: (await raw('/api/fleets/' + fleetId)).body, requestsBefore: before, requestsAfter: provider.requests.length, errors: daemon.errors().slice(-8192) }));
          throw error;
        }
        const request = provider.requests.at(-1), input = lastUser(request);
        assert(input.includes('[Crossfire session restarted]'), 'Recovery explicitly identifies the restarted session');
        if (!JSON.stringify(request).includes(marker)) {
          const location = /is saved at ("(?:[^"\\]|\\.)*")\./u.exec(input);
          assert(location, 'Uncertain native receipt must retain the exact original input in a private file');
          const path = join(fleetDirectory, 'agents/analyst/workarea/analyst', text(JSON.parse(location[1]!) as unknown));
          assert.equal(statSync(path).mode & 0o777, 0o600);
          assert(readFileSync(path, 'utf8').includes(marker), 'The restart context retains the original request verbatim');
        }
        assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
      }
    } finally { if (provider.held()) provider.finish(); }
    try { await observe(idle, 'Recovered native work completes and leaves the listener idle'); }
    catch (error) {
      const workarea = join(fleetDirectory, 'agents/analyst/workarea/analyst'), state = join(workarea, '.crossfire/state/analyst');
      const native = join(workarea, '.codex');
      const files = [...readdirSync(state).filter(name => name === 'resume-work.json' || name.endsWith('.controller-input')).map(name => join(state, name)),
        ...runtime === 'codex' ? readdirSync(native).filter(name => name.endsWith('.receipt')).map(name => join(native, name)) : []];
      child.diagnostic(JSON.stringify({ completionTimeout: files.map(file => ({ file, value: readFileSync(file, 'utf8').slice(0, 8192) })),
        fleet: (await raw('/api/fleets/' + fleetId)).body, requests: provider.requests.length, errors: daemon.errors().slice(-8192) }));
      throw error;
    }
    assert.deepEqual(JSON.parse(readFileSync(checkpoint, 'utf8')) as unknown, [], 'Verified native completion clears the durable work record');
  });
  await scope.test('explicit fresh-history reset retains enrolled identity and makes no housekeeping model call', async () => {
    const original = saved, requests = provider.requests.length;
    const binding = readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8');
    await operate('reset');
    saved = (await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data;
    assert.equal(list(saved).length, 1);
    assert.equal(record(list(saved)[0]).runtime, runtime);
    assert.notDeepEqual(saved, original, 'Only an explicit reset replaces the native history');
    assert.equal(readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8'), binding, 'Reset never reenrolls or replaces accounts and credentials');
    assert.equal(provider.requests.length, requests, 'Reset exports context and instructions without model housekeeping');
  });
  await scope.test('per-room stop and resume continue only unfinished work in its exact history', async () => {
    const configuration = join(fleetDirectory, 'runtime.toml'), original = readFileSync(configuration, 'utf8');
    await operate('stop');
    const roster = list(record((await call(operations.fleet, { fleetId })).data).instances);
    assert.equal(roster.length, 1); assert.equal(record(record(roster[0]).instance).key, 'analyst');
    writeFileSync(configuration, runtimeSource.replace('[instances.runtime_options]', '[instances.listener_options]\nhistory_mode = "per-room"\n[instances.runtime_options]'), { mode: 0o600 });
    try {
      await operate('reset');
      async function matrix(method: string, path: string, body?: unknown) {
        const response = await contractHttp(platform.origin, method, '/_matrix/client/v3' + path, body, { Authorization: 'Bearer ' + platform.owner.nativeToken });
        assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 1024)); return record(response.body);
      }
      const rooms: string[] = [];
      for (const name of ['Completed room', 'Unfinished room']) {
        const room = text((await matrix('POST', '/createRoom', { name, invite: [backendUserId] })).room_id); rooms.push(room);
        await observe(async () => Object.hasOwn(record((await matrix('GET', '/rooms/' + encodeURIComponent(room) + '/joined_members')).joined), backendUserId),
          'The same listener accepts an authorized per-room invitation', 90000);
      }
      const send = (room: string, body: string) => matrix('PUT', '/rooms/' + encodeURIComponent(room) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body });
      const completed = 'Completed private room task ' + randomUUID(), unfinished = 'Unfinished private room task ' + randomUUID();
      const beforeCompleted = provider.requests.length;
      await send(rooms[0]!, completed);
      await observe(() => provider.requests.length > beforeCompleted && lastUser(provider.requests.at(-1)).includes(completed), 'The completed room receives its own native input');
      let completedSession = '';
      await observe(async () => {
        const contexts = list((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data).map(record);
        completedSession = text(contexts.find(value => value.context === roomContext(rooms[0]!))?.sessionId ?? '');
        const response = await contractHttp(platform.origin, 'GET', '/api/agents/' + agentId + '/runtime-observations', undefined, { Cookie: platform.owner.cookie, Origin: platform.origin });
        return response.status === 200 && list(record(response.body).data).map(record).some(value => value.sessionId === completedSession && value.state === 'idle');
      }, 'The completed room reaches observed native idle');
      await observe(() => publications().some(journal => journal.sessionId === completedSession && journal.pending === null && journal.confirmed.length === 0),
        'The delivery producer acknowledges the completed room input before it is classified as finished');
      provider.hold(); await send(rooms[1]!, unfinished);
      await observe(() => provider.held() !== undefined && lastUser(provider.requests.at(-1)).includes(unfinished), 'Another room has actual unfinished native work');
      const histories = (await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data;
      assert.deepEqual(list(histories).map(record).map(value => value.context).sort(), ['control', ...rooms.map(roomContext)].sort());
      const previousResponse = provider.held()!;
      await operate('stop');
      await observe(() => previousResponse.destroyed, 'Stop closes the exact native writer for the unfinished room');
      const checkpoint = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/resume-work.json');
      assert.deepEqual(list(JSON.parse(readFileSync(checkpoint, 'utf8')) as unknown).map(record).map(value => value.context), [roomContext(rooms[1]!)],
        'A completed room cannot receive synthetic restart work because another room is busy');
      const beforeResume = provider.requests.length;
      provider.hold(); const resuming = operate('start');
      try {
        await observe(() => provider.requests.length > beforeResume && provider.held() !== undefined, 'Resume continues the actual unfinished room', 90000);
        assert(lastUser(provider.requests.at(-1)).includes('[Crossfire session restarted]'));
        assert(!JSON.stringify(provider.requests.at(-1)).includes(completed), 'The unfinished room never receives another room task history');
      } finally { if (provider.held()) provider.finish(); await resuming; }
      try { await observe(idle, 'Per-room resume settles to native idle'); }
      catch (error) {
        try {
          const cursors = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/cursors.json');
          const producers = ['.chat-publication', '.steering-publication'].map(suffix => {
            if (!existsSync(cursors + suffix)) return { kind: suffix, steps: null };
            const plan = record(JSON.parse(readFileSync(cursors + suffix, 'utf8')) as unknown);
            return { kind: suffix, steps: list(plan.steps).map(record).map(({ id, room, session, status }) => ({ id, room, session, status })) };
          });
          const nativeRequests = provider.requests.slice(-4).map(request => ({ lastUser: lastUser(request).slice(-600) }));
          scope.diagnostic(JSON.stringify({ nativeInspection, work: JSON.parse(readFileSync(checkpoint, 'utf8')) as unknown, journals: publications(), producers, nativeRequests }).slice(0, 8192));
        } catch (diagnosticError) { scope.diagnostic(String(diagnosticError).slice(0, 1024)); }
        throw error;
      }
      assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, histories, 'Every room retains its exact saved native history');
      assert.deepEqual(JSON.parse(readFileSync(checkpoint, 'utf8')) as unknown, []);
    } finally {
      if (provider.held()) provider.finish();
      await operate('stop'); writeFileSync(configuration, original, { mode: 0o600 }); await operate('reset');
      saved = (await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data;
    }
  });
  await scope.test('quiet native output preserves collection work, telemetry, explicit messages and saved history', async () => {
    const configuration = join(fleetDirectory, 'runtime.toml'), original = readFileSync(configuration, 'utf8');
    await operate('stop');
    const histories = (await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data;
    writeFileSync(configuration, runtimeSource.replace('[instances.runtime_options]', '[instances.listener_options]\nmirror_output = false\n[instances.runtime_options]'), { mode: 0o600 });
    const conversation = await contractHttp(platform.origin, 'POST', '/api/agents/' + agentId + '/owner-conversation', {}, { Authorization: 'Bearer ' + token });
    assert.equal(conversation.status, 200); const room = text(record(record(conversation.body).data).roomId);
    async function matrix(path: string) {
      const result = await contractHttp(platform.origin, 'GET', '/_matrix/client/v3' + path, undefined, { Authorization: 'Bearer ' + platform.owner.nativeToken });
      assert.equal(result.status, 200); return record(result.body);
    }
    const filter = '&filter=' + encodeURIComponent(JSON.stringify({ room: { rooms: [room], timeline: { limit: 100 } } }));
    const before = text((await matrix('/sync?timeout=0' + filter)).next_batch);
    try {
      await operate('start');
      const instance = record(record((await call(operations.agent, { fleetId, instanceKey: 'analyst' })).data).instance);
      assert.equal(record(instance.listenerOptions).mirrorOutput, false);
      const requests = provider.requests.length; provider.hold();
      await call(operations.createFleetMessage, { fleetId }, { messageId: randomUUID(), body: 'Quiet collection proof ' + randomUUID() });
      await observe(() => provider.requests.length > requests && provider.held() !== undefined, 'Quiet collection still reaches the actual native provider');
      provider.finish(); await observe(idle, 'Quiet collection still reports native completion');
      assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, histories);
      await operate('stop');
      const sync = await matrix('/sync?timeout=0&since=' + encodeURIComponent(before) + filter);
      const joined = record(record(sync.rooms ?? {}).join ?? {}), events = Object.hasOwn(joined, room) ? list(record(record(joined[room]).timeline).events).map(record) : [];
      assert.equal(events.some(event => event.sender === backendUserId && String(record(event.content).body).includes('Fixture complete.')), false, 'Completed native output never reaches Matrix when mirroring is disabled');
      const state = JSON.parse(readFileSync(join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/cursors.json.observation'), 'utf8')) as unknown;
      assert.equal(list(record(state).output).some(value => text(record(value).text).includes('Fixture complete.')), false, 'No per-tool output is left queued for later publication');
      const sent = await contractHttp(platform.origin, 'PUT', '/_matrix/client/v3/rooms/' + encodeURIComponent(room) + '/send/m.room.message/' + randomUUID(),
        { msgtype: 'm.text', body: 'Explicit important result' }, { Authorization: 'Bearer ' + token });
      assert.equal(sent.status, 200, 'Intentional agent messages remain available');
    } finally {
      if (provider.held()) provider.finish();
      await operate('stop'); writeFileSync(configuration, original, { mode: 0o600 }); await operate('start');
    }
  });
  await scope.test('stop, daemon restart and explicit resume retain history and stop intent', async () => {
    const authentication = readFileSync(authenticationFile);
    const completedRequests = provider.requests.length;
    await operate('stop'); const stopped = record((await call(operations.fleet, { fleetId })).data); assert.equal(record(list(stopped.instances)[0]).desiredActive, false); assert.equal(record(list(stopped.instances)[0]).phase, 'stopped'); assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    await call(operations.operate, {}, { operationId: randomUUID(), target: { kind: 'daemon' }, action: 'stop', expectedRevision: 0 }); await daemon.ended; daemon = contractProcess(scope, selected.daemon, ['--root', root], directory, environment);
    await observe(async () => { try { return (await raw('/api/status')).status === 200; } catch { return false; } }, 'Restarted daemon becomes ready'); const retained = record((await call(operations.fleet, { fleetId })).data); assert.equal(record(list(retained.instances)[0]).desiredActive, false); await operate('start'); assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved); assert.equal(provider.requests.length, completedRequests, 'Restart and explicit resume do not inject another model turn for finished work');
    assert.deepEqual(readFileSync(authenticationFile), authentication, 'Restart retains the same authentication file bytes');
    await operate('stop');
  });
  await scope.test('operation replay is idempotent, conflicting IDs are rejected and instance update preserves stop intent', async () => {
    const completed = await operate('stop', 'analyst'), requests = provider.requests.length;
    const input = { operationId: text(completed.operationId), target: completed.target, action: completed.action, expectedRevision: integer(completed.expectedRevision) };
    assert.deepEqual((await call(operations.operate, {}, input)).data, completed);
    contractError(await raw('/api/operations', 'POST', { ...input, action: 'start' }), 409, 'conflict');
    contractError(await raw('/api/operations', 'POST', { ...input, operationId: randomUUID(), expectedRevision: integer(input.expectedRevision) + 1 }), 409, 'stale_revision');
    const binding = readFileSync(join(fleetDirectory, '.fleet/binding.json'));
    await operate('update', 'analyst');
    const current = record((await call(operations.fleet, { fleetId })).data), instance = record(list(current.instances)[0]);
    assert.equal(instance.desiredActive, false); assert.equal(instance.phase, 'stopped');
    assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    assert.deepEqual(readFileSync(join(fleetDirectory, '.fleet/binding.json')), binding);
    contractError(await raw('/api/fleets/' + fleetId + '/readiness'), 409, 'conflict');
    contractError(await raw('/api/fleets/' + fleetId + '/agents/analyst/attachment'), 409, 'conflict');
    assert.equal(provider.requests.length, requests, 'Update and read-only diagnostics cannot restart an explicitly stopped instance');
  });
  await scope.test('management session requests reach the actual controller and retain native history', async () => {
    await operate('start', 'analyst');
    await operate('stop');
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
  await scope.test('setup reuses stopped identities and unregistration retains authored roles and native histories', async () => {
    const requests = provider.requests.length;
    const response = await contractHttp(platform.origin, 'GET', '/onboarding/setup.json?ownerBackendUserId=' + encodeURIComponent(platform.owner.backendUserId), undefined, { Cookie: platform.owner.cookie });
    assert.equal(response.status, 200);
    const input = { descriptor: response.body, workspace: fleetDirectory, configuration: join(fleetDirectory, 'runtime.toml') };
    for (let repeated = 0; repeated < 2; repeated++) {
      const result = record((await call(operations.setup, {}, input)).data);
      assert.equal(result.status, 'stopped'); assert.equal(record(result.fleet).fleetId, fleetId);
      assert.equal(result.operation, null);
      assert.deepEqual((await call(operations.contexts, { fleetId, instanceKey: 'analyst' })).data, saved);
    }
    const authored = readFileSync(join(role, 'AGENTS.md')), binding = readFileSync(join(fleetDirectory, '.fleet/binding.json'));
    const current = record((await call(operations.fleet, { fleetId })).data);
    assert.equal(record((await call(operations.removeFleet, { fleetId }, { expectedRevision: integer(current.revision) })).data).accepted, true);
    assert.equal(list((await call(operations.fleets)).data).length, 0);
    assert.deepEqual(readFileSync(join(role, 'AGENTS.md')), authored);
    assert.deepEqual(readFileSync(join(fleetDirectory, '.fleet/binding.json')), binding);
    contractError(await raw('/api/setup', 'POST', input), 409, 'conflict');
    assert.equal(provider.requests.length, requests);
  });
  assert.deepEqual(Object.entries(operations).filter(([_name, operation]) => !successful.has(operation.method + ' ' + operation.path)
    && !unsupported.has(operation.method + ' ' + operation.path)).map(([name]) => name), [], 'Every daemon declaration requires a decoded shared success or an explicitly unsupported native capability');
  assert.deepEqual([...unsupported], runtime === 'pi' ? [operations.attachment.method + ' ' + operations.attachment.path] : [], 'Pi has no terminal attachment; no backend-specific acceptance exclusions are allowed');
}
