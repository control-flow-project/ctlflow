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
import { lastUser, messageContracts } from './messages.contract.js';
import { paginationContracts } from '@ctlflow/crossfire-test-support/contract-pagination';
import { readAuthentication } from '@ctlflow/fleetd-storage/authentication';
import { authenticationContracts } from './authentication.contract.js';
import { storageContracts } from './storage.contract.js';

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
  await storageContracts(scope, selected, directory, environment);
  await paginationContracts(scope, query => raw('/api/fleets' + query));
  cleanup(scope, async () => { try { await call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 }); } catch { await daemon.close(); } });
  const role = join(fleetDirectory, 'agents/analyst'); mkdirSync(role, { recursive: true, mode: 0o700 });
  const effort = runtime === 'codex' ? 'model_reasoning_effort' : 'thinking_level'; const defaults = runtime === 'codex' ? 'sandbox_mode = "read-only"\napproval_policy = "never"\nfeatures = { default_mode_request_user_input = true }\n' : 'provider = "fixture"\nmodel = "fixture-model"\n';
  writeFileSync(join(role, 'agent.toml'), 'name = "Contract analyst"\nruntime = ' + JSON.stringify(runtime) + '\n[runtime_options]\n' + defaults + effort + ' = "medium"\n', { mode: 0o600 }); writeFileSync(join(role, 'AGENTS.md'), 'Only obey the authorized shared contract fixture. Use explicit tools for room replies.\n', { mode: 0o600 });
  writeFileSync(join(fleetDirectory, 'runtime.toml'), 'fleet = "shared-' + runtime + '"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(platform.origin) + '\nowner = ' + JSON.stringify(platform.owner.matrixUserId) + '\n[[instances]]\nkey = "analyst"\nname = "shared-analyst-' + runtime + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/analyst"\n[instances.runtime_options]\n' + effort + ' = "high"\n', { mode: 0o600 });
  let fleetId = '', revision = 0, saved: unknown, agentId = '', matrixUserId = '', token = '';
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
  await scope.test('stopped roster mutations are revision-qualified, bounded and preserve authored roles', async () => {
    const authored = readFileSync(join(role, 'AGENTS.md'));
    const reviewer = join(fleetDirectory, 'agents/reviewer'); mkdirSync(reviewer, { mode: 0o700 });
    writeFileSync(join(reviewer, 'agent.toml'), readFileSync(join(role, 'agent.toml')), { mode: 0o600 });
    writeFileSync(join(reviewer, 'AGENTS.md'), 'An alternate authored role.\n', { mode: 0o600 });
    let current = record((await call(operations.fleet, { fleetId })).data);
    const extra = { key: 'temporary', name: 'temporary-' + runtime, definition: 'analyst', workarea: 'agents/analyst/workarea/temporary' };
    current = record((await call(operations.addAgent, { fleetId }, { expectedRevision: integer(current.revision), instance: extra })).data);
    const registered = await call(operations.agents, { fleetId }, undefined, '?pageSize=1');
    assert.equal(registered.meta.totalItems, 2); assert.equal(list(registered.data).length, 1);
    assert.equal(record(record((await call(operations.agent, { fleetId, instanceKey: extra.key })).data).instance).name, extra.name);
    const bytes = readFileSync(join(fleetDirectory, 'runtime.toml'));
    contractError(await raw('/api/fleets/' + fleetId + '/agents', 'POST', { expectedRevision: integer(current.revision) - 1, instance: extra }), 409, 'stale_revision');
    for (const duplicate of [extra, { ...extra, name: 'different-' + runtime }, { ...extra, key: 'another', workarea: 'agents/analyst/workarea/another' }]) {
      contractError(await raw('/api/fleets/' + fleetId + '/agents', 'POST', { expectedRevision: integer(current.revision), instance: duplicate }), 409, 'name_collision');
    }
    assert.deepEqual(readFileSync(join(fleetDirectory, 'runtime.toml')), bytes);
    current = record((await call(operations.changeAgent, { fleetId, instanceKey: extra.key }, { expectedRevision: integer(current.revision), definition: 'reviewer' })).data);
    assert.equal(record(record(list(current.instances).find(value => record(record(value).instance).key === extra.key)).instance).definition, 'reviewer');
    current = record((await call(operations.removeAgent, { fleetId, instanceKey: extra.key }, { expectedRevision: integer(current.revision) })).data);
    revision = integer(current.revision); assert.equal(list(current.instances).length, 1);
    assert.deepEqual(readFileSync(join(role, 'AGENTS.md')), authored);
    assert.equal(existsSync(join(role, 'workarea')), false, 'Roster inspection and edits never create native state');
    assert.equal(provider.requests.length, 0);
  });
  await scope.test('every daemon operation rejects unknown query fields before effects', async () => {
    const before = readFileSync(join(root, 'fleets.json')), current = record((await call(operations.fleet, { fleetId })).data);
    const response = await contractHttp(platform.origin, 'GET', '/onboarding/setup.json?ownerMatrixId=' + encodeURIComponent(platform.owner.matrixUserId), undefined, { Cookie: platform.owner.cookie });
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
    const binding = JSON.parse(readFileSync(join(fleetDirectory, '.fleet/binding.json'), 'utf8')) as unknown; const identity = record(list(record(binding).identities)[0]); agentId = text(identity.agentId); const account = record(identity.account); matrixUserId = text(account.user_id); token = text(account.access_token);
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
  await scope.test('real native chat, steering and bounded history contracts', child => messageContracts(child, { platform, fleetDirectory, agent: { id: agentId, matrixUserId, token }, provider,
    async idle() { const file = join(fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/listener.json'); const endpoint = record(JSON.parse(readFileSync(file, 'utf8')) as unknown); const response = await contractHttp('http://127.0.0.1:' + String(endpoint.port), 'POST', '/bindings/' + text(endpoint.binding) + '/control', { action: 'test' }, { Authorization: 'Bearer ' + text(endpoint.secret) }); return response.status === 200 && record(record(response.body).test).busy === false; },
    async delivery(enabled) { const fleet = record((await call(operations.fleet, { fleetId })).data); await call(operations.changeFleetDelivery, { fleetId }, { expectedRevision: integer(record(fleet.connection).revision), enabled }); await observe(async () => record(list(record((await call(operations.fleet, { fleetId })).data).instances)[0]).listenerActive === enabled, 'Controller applies delivery intent'); } }));
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
  await scope.test('a crash during a held native response resumes the same history and unfinished request', async child => {
    child.after(() => { if (provider.held()) provider.finish(); });
    const before = provider.requests.length, marker = 'Resume this unfinished fleet request ' + randomUUID();
    provider.hold();
    await call(operations.createFleetMessage, { fleetId }, { messageId: randomUUID(), body: marker });
    await observe(() => provider.held() !== undefined, 'Fleet broadcast reaches the actual native engine');
    assert(lastUser(provider.requests.at(-1)).includes(marker)); const original = provider.held()!;
    provider.hold(); assert.equal(daemon.child.kill('SIGKILL'), true); await daemon.ended;
    await observe(() => original.destroyed, 'A dead controller leaves no native writer holding the old provider response');
    daemon = contractProcess(scope, selected.daemon, ['--root', root], directory, environment);
    await observe(() => provider.requests.length >= before + 2 && provider.held() !== undefined, 'Restart resumes the unfinished request rather than silently dropping it', 90000);
    try {
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
    } finally { provider.finish(); }
    await observe(async () => (await raw('/api/fleets/' + fleetId + '/readiness')).status === 200, 'Recovered native work completes and leaves the listener ready');
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
    const response = await contractHttp(platform.origin, 'GET', '/onboarding/setup.json?ownerMatrixId=' + encodeURIComponent(platform.owner.matrixUserId), undefined, { Cookie: platform.owner.cookie });
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
