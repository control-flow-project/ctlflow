import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createListenerControl } from '@ctlflow/crossfire-agent-core/listener-control';
import { createController } from '@ctlflow/fleetd-domain/controller';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import type { Execution, Services } from '@ctlflow/fleetd-domain/port';
import type { SetupInput, Operation } from '@ctlflow/fleetd-domain/model';
import { success, failure, type Result } from '@ctlflow/crossfire-kernel/result';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!predicate()) { assert(performance.now() < deadline, 'Setup controller observation exceeded its deadline'); await yieldLoop(); }
}
function fixture(execution: Partial<Execution> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-controller-setup-')), root = join(directory, 'controller'), workspace = join(directory, 'project');
  mkdirSync(workspace, { mode: 0o755 });
  const calls: string[] = [], histories = new Map<string, string>();
  const registry = createRegistry(root), services: Services = { registry, id: randomUUID, now: Date.now, controller: { name: 'test' },
    delay: async (_milliseconds, signal) => new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); }),
    execution: {
      connect: () => success(undefined), connection: () => ({ connected: true, deliveryEnabled: true, revision: 0, error: null }),
      disconnect: async () => {}, close: async () => {}, delivery: async () => failure('unavailable', 'Unused fixture port'), message: async () => failure('unavailable', 'Unused fixture port'),
      validate: () => success(undefined), inspect: async () => { calls.push('inspect'); return success(undefined); }, test: async () => success(undefined),
      prepare: async () => { calls.push('prepare'); return success(undefined); },
      reset: async () => { calls.push('reset'); return success(undefined); }, confirmStopped: async () => success(undefined), remove: async () => success(undefined), archive: async () => success(undefined),
      update: async (_configuration, instance, releaseDirectory) => { calls.push('update:' + instance.key + ':' + releaseDirectory); return success(undefined); },
      contexts: async (_configuration, instance) => success(histories.has(instance.key) ? [{ context: 'shared', runtime: 'codex', sessionId: histories.get(instance.key)! }] : []),
      start: async (_configuration, instance, _signal, reason) => {
        calls.push('start:' + instance.key + ':' + reason);
        const sessionId = histories.get(instance.key) ?? randomUUID(); histories.set(instance.key, sessionId);
        const stop = new AbortController(), binding = createListenerControl(async () => {}, () => ({ fleetId: randomUUID(), connectionId: randomUUID(), credential: 'fixture-lease' }));
        binding.update({ connected: true, active: true, input: null });
        return success({ sessionId, signal: stop.signal, control: binding.connection,
          diagnostics: async () => ({ checkedAt: 1, state: 'idle' as const, observedAt: 1, provider: 'unknown' as const, providerObservedAt: null, pendingInput: false, pendingDecision: false }),
          nativeState: () => ({ phase: 'running' as const, lastActivityAt: 1, historyAvailable: true }), resume: async () => success(undefined),
          contexts: async () => success([{ context: 'shared', runtime: 'codex', sessionId }]),
          attachment: async () => failure('conflict', 'No native process in domain fixture'), attachments: async () => success([]),
          close: async () => { calls.push('close:' + instance.key); stop.abort(); } });
      }, ...execution,
    } };
  const controller = value(createController(services)), input: SetupInput = { workspace,
    descriptor: { schemaVersion: 1, server: 'https://example.test', ownerBackendUserId: '@owner:example.test', package: { name: '@ctlflow/fleet', version: '0.1.0' }, instructions: '' } };
  async function finish(operation: Operation): Promise<Operation> {
    await until(() => value(controller.operation(operation.operationId)).completedAt !== null);
    return value(controller.operation(operation.operationId));
  }
  async function operate(fleetId: string, action: 'start' | 'stop' | 'update', instanceKey?: string) {
    return finish(value(await controller.operate({ operationId: randomUUID(), action,
      expectedRevision: value(controller.view(fleetId)).revision,
      target: instanceKey ? { kind: 'agent', fleetId, instanceKey } : { kind: 'fleet', fleetId },
      ...(action === 'update' ? { releaseDirectory: '/owned/installed/release' } : {}) })));
  }
  return { directory, services, controller, input, calls, histories, registry, finish, operate };
}

test('first setup starts one ordinary fleet; repeated setup reuses registry, identity, exact history and controller without starting again', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation);
  assert.equal((await current.finish(first.operation)).status, 'succeeded');
  const ready = value(await current.controller.setup(current.input)); assert.equal(ready.status, 'ready'); assert.equal(ready.operation, null);
  assert.equal(ready.fleet.fleetId, first.fleet.fleetId); assert.equal(ready.fleet.instances.length, 1);
  const history = ready.fleet.instances[0]!.sessionId;
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, 1); assert.equal(current.calls.includes('reset'), false);
  await current.controller.close();
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close()); await reopened.ready();
  const repeated = value(await reopened.setup(current.input)); assert.equal(repeated.fleet.fleetId, first.fleet.fleetId);
  assert.equal(repeated.fleet.instances[0]!.sessionId, history);
  assert.equal(current.calls.filter(call => call.endsWith(':recovery')).length, 1, 'Controller restart resumes desired native history once');
});

test('setup waits for exact human approval, concurrent repeats share its operation and no native start occurs before approval', async scope => {
  let approve!: () => void, approvals = 0;
  const current = fixture({ prepare: async (_configuration, _controller, _intent, signal, approval) => {
    approvals++; approval({ url: 'https://example.test/manage/enrollments/exact', code: 'ABCDEF123456' });
    await new Promise<void>(resolve => { approve = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    return signal.aborted ? failure('unavailable', 'Approval cancelled') : success(undefined);
  } }); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const [first, repeated] = await Promise.all([current.controller.setup(current.input), current.controller.setup(current.input)]);
  const prepared = value(first), duplicate = value(repeated); assert(prepared.operation); assert(duplicate.operation);
  assert.equal(prepared.operation.operationId, duplicate.operation.operationId);
  await until(() => value(current.controller.operation(prepared.operation!.operationId)).status === 'awaiting-approval');
  assert.deepEqual(value(current.controller.operation(prepared.operation.operationId)).approval, { url: 'https://example.test/manage/enrollments/exact', code: 'ABCDEF123456' });
  assert.equal(approvals, 1); assert.equal(current.calls.some(call => call.startsWith('start:')), false);
  approve(); assert.equal((await current.finish(prepared.operation)).status, 'succeeded');
});

test('repeat setup requires actual model-free listener readiness and refuses busy delivery without restarting a session', async scope => {
  let ready = false, inspections = 0;
  const current = fixture({ test: async () => { inspections++; return ready ? success(undefined) : failure('conflict', 'Native session is busy'); } });
  cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  const blocked = await current.controller.setup(current.input); assert(!blocked.ok); assert.equal(blocked.error.code, 'conflict');
  assert.equal(blocked.error.message.includes('busy'), true); ready = true;
  const repeated = value(await current.controller.setup(current.input)); assert.equal(repeated.status, 'ready'); assert.equal(inspections, 2);
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, 1); assert.equal(current.calls.includes('reset'), false);
});

test('repeat setup waits for its ongoing native restoration without another start, operation, enrollment or history', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  const history = value(current.controller.view(first.fleet.fleetId)).instances[0]!.sessionId;
  await current.controller.close();
  let finish!: () => void, settled = false;
  const start = current.services.execution.start;
  current.services.execution.start = async (...args) => {
    await new Promise<void>(resolve => { finish = resolve; args[2].addEventListener('abort', () => resolve(), { once: true }); });
    return args[2].aborted ? failure('unavailable', 'Controlled restoration stopped') : start(...args);
  };
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close());
  await until(() => finish !== undefined); const inspected = current.calls.filter(call => call === 'inspect').length;
  const repeated = reopened.setup(current.input).then(result => { settled = true; return result; });
  await until(() => current.calls.filter(call => call === 'inspect').length > inspected); await yieldLoop();
  assert.equal(settled, false, 'Setup cannot claim readiness or compete with the current native restoration');
  finish(); const result = value(await repeated); assert.equal(result.status, 'ready'); assert.equal(result.operation, null);
  assert.equal(result.fleet.instances[0]!.sessionId, history);
  assert.deepEqual(current.calls.filter(call => call.startsWith('start:')).map(call => call.split(':').at(-1)), ['operator', 'recovery']);
  assert.equal(current.calls.filter(call => call === 'prepare').length, 1); assert.equal(value(current.registry.operation(first.operation!.operationId))!.operationId, first.operation!.operationId);
  assert.equal(readdirSync(join(current.directory, 'controller', 'operations')).length, 1);
});

test('setup awaits only its own restored fleet and does not wait for unrelated native initialization', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  const otherWorkspace = join(current.directory, 'other'); mkdirSync(otherWorkspace, { mode: 0o755 });
  const second = value(await current.controller.setup({ ...current.input, workspace: otherWorkspace })); assert(second.operation); await current.finish(second.operation);
  const otherKey = value(current.controller.view(second.fleet.fleetId)).instances[0]!.instance.key;
  await current.controller.close(); let finish!: () => void;
  const start = current.services.execution.start;
  current.services.execution.start = async (...args) => {
    if (args[1].key === otherKey) await new Promise<void>(resolve => { finish = resolve; args[2].addEventListener('abort', () => resolve(), { once: true }); });
    return args[2].aborted ? failure('unavailable', 'Controlled unrelated restoration stopped') : start(...args);
  };
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close());
  await until(() => finish !== undefined);
  const repeated = value(await reopened.setup(current.input)); assert.equal(repeated.status, 'ready'); assert.equal(repeated.fleet.fleetId, first.fleet.fleetId);
  assert.equal(value(reopened.view(second.fleet.fleetId)).instances[0]!.phase, 'starting'); finish(); await reopened.ready();
  assert.equal(current.calls.filter(call => call === 'prepare').length, 2);
});

test('successful restoration finishes interrupted setup without repeating lifecycle or replacing its exact history', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const complete = current.registry.completeSetup; let available = false;
  current.registry.completeSetup = operationId => available ? complete(operationId) : failure('unavailable', 'Controlled setup completion persistence failure');
  const first = value(await current.controller.setup(current.input)); assert(first.operation); assert.equal((await current.finish(first.operation)).status, 'failed');
  const history = value(current.controller.view(first.fleet.fleetId)).instances[0]!.sessionId; await current.controller.close(); available = true;
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close());
  const repeated = value(await reopened.setup(current.input)); assert.equal(repeated.status, 'ready'); assert.equal(repeated.operation, null);
  assert.equal(repeated.fleet.instances[0]!.sessionId, history); assert.equal(value(current.registry.setup(current.input)).completed, true);
  assert.deepEqual(current.calls.filter(call => call.startsWith('start:')).map(call => call.split(':').at(-1)), ['operator', 'recovery']);
  assert.equal(current.calls.filter(call => call === 'prepare').length, 1); assert.equal(value(current.registry.operation(first.operation!.operationId))!.operationId, first.operation!.operationId);
  assert.equal(readdirSync(join(current.directory, 'controller', 'operations')).length, 1);
});

test('explicit stop during setup restoration stays stopped rather than restarting after its readiness wait', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation); await current.controller.close();
  let started = false;
  current.services.execution.start = async (_configuration, _instance, signal) => {
    started = true; await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    return failure('unavailable', 'Restoration cancelled by explicit stop');
  };
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close()); await until(() => started);
  const repeated = reopened.setup(current.input), stopping = value(await reopened.operate({ operationId: randomUUID(), action: 'stop',
    target: { kind: 'fleet', fleetId: first.fleet.fleetId }, expectedRevision: value(reopened.view(first.fleet.fleetId)).revision }));
  await until(() => value(reopened.operation(stopping.operationId)).completedAt !== null);
  assert.equal(value(reopened.operation(stopping.operationId)).status, 'succeeded'); assert.equal(value(await repeated).status, 'stopped');
  assert.deepEqual(value(current.registry.desiredIntent()), []); assert.equal(current.calls.filter(call => call === 'prepare').length, 1);
});

test('readiness checks sleeping bindings without native wake; stopped readiness cannot start a process', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const start = current.services.execution.start;
  current.services.execution.start = async (...args) => {
    const running = await start(...args); assert(running.ok);
    return success({ ...running.value, nativeState: () => ({ phase: 'sleeping' as const, lastActivityAt: 1, historyAvailable: true }),
      resume: async () => { assert.fail('Read-only readiness cannot wake native execution'); } });
  };
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  assert.equal(value(current.controller.view(first.fleet.fleetId)).phase, 'sleeping'); assert((await current.controller.test(first.fleet.fleetId)).ok);
  await current.operate(first.fleet.fleetId, 'stop'); assert.equal((await current.controller.test(first.fleet.fleetId)).ok, false);
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, 1);
});

test('stop receipt failure is visible while native execution remains stopped and explicit retry does not restart it', async scope => {
  let acknowledged = false, confirmations = 0;
  const current = fixture({ confirmStopped: async () => { confirmations++; return acknowledged ? success(undefined) : failure('unavailable', 'Native close receipt is awaiting acknowledgment'); } });
  cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  const stopped = await current.operate(first.fleet.fleetId, 'stop'); assert.equal(stopped.status, 'failed');
  const view = value(current.controller.view(first.fleet.fleetId)); assert.equal(view.instances[0]!.phase, 'stopped'); assert.equal(view.instances[0]!.desiredActive, false);
  assert.equal(view.instances[0]!.error, 'Native close receipt is awaiting acknowledgment');
  acknowledged = true; assert.equal((await current.operate(first.fleet.fleetId, 'stop')).status, 'succeeded'); assert.equal(confirmations, 2);
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, 1); assert.equal(current.calls.filter(call => call.startsWith('close:')).length, 1);
});

test('archiving a completed setup does not implicitly recreate its registration or reactivate its preserved native history', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation); await current.finish(first.operation);
  const ready = value(await current.controller.setup(current.input)), history = ready.fleet.instances[0]!.sessionId;
  await current.operate(first.fleet.fleetId, 'stop'); assert((await current.controller.remove(first.fleet.fleetId, ready.fleet.revision)).ok);
  const repeated = await current.controller.setup(current.input); assert(!repeated.ok); assert.equal(repeated.error.code, 'conflict');
  assert.deepEqual(value(current.controller.list()), []); assert.equal(current.histories.get(ready.fleet.instances[0]!.instance.key), history);
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, 1);
});

test('missing prerequisite fails before enrollment and retry reuses the private generated configuration', async scope => {
  let available = false;
  const current = fixture({ inspect: async () => available ? success(undefined) : failure('missing', 'Install Codex and use native provider login') });
  cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const failed = await current.controller.setup(current.input); assert(!failed.ok); assert.equal(failed.error.code, 'missing');
  assert.deepEqual(value(current.controller.list()), []); assert.equal(current.calls.includes('prepare'), false);
  const saved = value(current.registry.setup(current.input)); available = true;
  const retried = value(await current.controller.setup(current.input)); assert(retried.operation);
  assert.equal(retried.fleet.directory, saved.configuration.directory); assert.equal(retried.operation.operationId, saved.operationId);
  assert.equal((await current.finish(retried.operation)).status, 'succeeded');
});

test('failed setup can retry its initial operation without another identity; explicit stop remains stopped across repeat setup and restart', async scope => {
  let fail = true;
  const current = fixture({ prepare: async () => fail ? failure('unavailable', 'Fixture enrollment transport failure') : success(undefined) });
  cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation);
  assert.equal((await current.finish(first.operation)).status, 'failed'); fail = false;
  const retried = value(await current.controller.setup(current.input)); assert(retried.operation);
  assert.notEqual(retried.operation.operationId, first.operation.operationId); assert.equal(retried.fleet.fleetId, first.fleet.fleetId);
  assert.equal((await current.finish(retried.operation)).status, 'succeeded');
  const active = value(current.controller.view(first.fleet.fleetId)), history = active.instances[0]!.sessionId;
  assert.equal((await current.operate(first.fleet.fleetId, 'stop')).status, 'succeeded');
  const starts = current.calls.filter(call => call.startsWith('start:')).length;
  const repeated = value(await current.controller.setup(current.input)); assert.equal(repeated.status, 'stopped'); assert.equal(repeated.operation, null);
  await current.controller.close();
  const reopened = value(createController(current.services)); cleanup(scope, () => reopened.close()); await reopened.ready();
  assert.equal(value(await reopened.setup(current.input)).status, 'stopped');
  assert.equal(current.calls.filter(call => call.startsWith('start:')).length, starts);
  const resumed = value(await reopened.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: first.fleet.fleetId }, expectedRevision: repeated.fleet.revision }));
  await until(() => value(reopened.operation(resumed.operationId)).completedAt !== null);
  assert.equal(value(reopened.operation(resumed.operationId)).status, 'succeeded'); assert.equal(value(reopened.view(first.fleet.fleetId)).instances[0]!.sessionId, history);
});

test('explicit stop while initial approval is pending prevents subsequent setup from activating it', async scope => {
  const current = fixture({ prepare: async (_configuration, _controller, _intent, signal, approval) => {
    approval({ url: 'https://example.test/manage/enrollments/pending', code: 'ABCDEF123456' });
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return failure('unavailable', 'Explicit stop cancelled enrollment');
  } }); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const first = value(await current.controller.setup(current.input)); assert(first.operation);
  await until(() => value(current.controller.operation(first.operation!.operationId)).status === 'awaiting-approval');
  assert.equal((await current.operate(first.fleet.fleetId, 'stop')).status, 'succeeded');
  assert.equal(value(await current.controller.setup(current.input)).status, 'stopped');
  assert.equal(current.calls.some(call => call.startsWith('start:')), false);
});

test('reviewed update repairs refused configuration restoration without losing history or stopped intent', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const initial = value(await current.controller.setup(current.input)); assert(initial.operation); await current.finish(initial.operation);
  const fleetId = initial.fleet.fleetId, before = value(current.controller.view(fleetId)), first = before.instances[0]!;
  await current.operate(fleetId, 'stop');
  value(await current.controller.editInstance(fleetId, 0, { kind: 'add', instance: { key: 'stopped-peer', name: 'stopped-peer', definition: 'project', workarea: 'agents/project/workarea/stopped-peer' } }));
  await current.operate(fleetId, 'start', first.instance.key); await current.controller.close();
  const intent = value(current.registry.desiredIntent()), registered = value(current.registry.registrations())[0]!;
  writeFileSync(join(before.directory, 'agents/project/AGENTS.md'), 'Reviewed current role instructions.', { mode: 0o600 });
  current.calls.length = 0;
  const restarted = value(createController(current.services)); cleanup(scope, () => restarted.close()); await restarted.ready();
  assert.match(value(restarted.view(fleetId)).error!, /Fleet files changed/u);
  assert.equal(current.calls.some(call => call.startsWith('start:')), false, 'Unreviewed changed files cannot restore a native binding');
  const validate = current.services.execution.validate;
  current.services.execution.validate = () => failure('invalid', 'Invalid native configuration');
  const refused = await restarted.operate({ operationId: randomUUID(), action: 'update', target: { kind: 'fleet', fleetId },
    expectedRevision: registered.revision, releaseDirectory: '/owned/installed/release' });
  assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.error.code, 'invalid');
  assert.equal(value(current.registry.registrations())[0]!.digest, registered.digest);
  assert.equal(current.calls.some(call => call.startsWith('update:')), false, 'Validation precedes software installation and configuration acceptance');
  current.services.execution.validate = validate;
  const updated = value(await restarted.operate({ operationId: randomUUID(), action: 'update', target: { kind: 'fleet', fleetId },
    expectedRevision: registered.revision, releaseDirectory: '/owned/installed/release' }));
  await until(() => value(restarted.operation(updated.operationId)).completedAt !== null);
  assert.equal(value(restarted.operation(updated.operationId)).status, 'succeeded');
  const after = value(restarted.view(fleetId));
  assert.equal(after.error, null); assert.equal(after.revision, registered.revision + 1);
  assert.equal(after.instances[0]!.sessionId, first.sessionId); assert.equal(after.instances[0]!.desiredActive, true);
  assert.equal(after.instances[1]!.desiredActive, false); assert.equal(after.instances[1]!.phase, 'stopped');
  assert.deepEqual(value(current.registry.desiredIntent()), intent);
  assert.equal(current.calls.includes('prepare'), false); assert.equal(current.calls.includes('reset'), false);
});

test('consented update owns stop/install/resume with the same histories and never activates stopped agents', async scope => {
  const current = fixture(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  const initial = value(await current.controller.setup(current.input)); assert(initial.operation); await current.finish(initial.operation);
  const fleetId = initial.fleet.fleetId, first = value(current.controller.view(fleetId)).instances[0]!, history = first.sessionId;
  await current.operate(fleetId, 'stop');
  value(await current.controller.editInstance(fleetId, 0, { kind: 'add', instance: { key: 'stopped-peer', name: 'stopped-peer', definition: 'project', workarea: 'agents/project/workarea/stopped-peer' } }));
  await current.operate(fleetId, 'start', first.instance.key);
  current.calls.length = 0;
  const updated = await current.operate(fleetId, 'update'); assert.equal(updated.status, 'succeeded');
  assert.deepEqual(current.calls, ['close:' + first.instance.key, 'update:' + first.instance.key + ':/owned/installed/release',
    'update:stopped-peer:/owned/installed/release', 'start:' + first.instance.key + ':operator']);
  const after = value(current.controller.view(fleetId)); assert.equal(after.instances[0]!.sessionId, history);
  assert.equal(after.instances[1]!.desiredActive, false); assert.equal(after.instances[1]!.phase, 'stopped');
  assert.equal(current.calls.includes('prepare'), false); assert.equal(current.calls.includes('reset'), false);
  const repeated = await current.controller.operate({ operationId: updated.operationId, target: updated.target, action: 'update', expectedRevision: updated.expectedRevision, releaseDirectory: '/other/release' });
  assert.equal(repeated.ok, false, 'Idempotency keys include the exact consented release source');
});
