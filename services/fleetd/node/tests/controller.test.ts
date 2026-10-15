import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { createController } from '@ctlflow/fleetd-domain/controller';
import type { Execution, Running } from '@ctlflow/fleetd-domain/port';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import type { Operation } from '@ctlflow/fleetd-domain/model';
import type { NativeSessionState } from '@ctlflow/crossfire-agent-core/runtime';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { validateRoster, parseToml } from '@ctlflow/fleetd-contracts/configuration';
import { fleetView, instanceView } from '@ctlflow/fleetd-contracts/api';
import { success, failure, type Result } from '@ctlflow/crossfire-kernel/result';
import { createListenerControl as listenerControl } from '@ctlflow/crossfire-agent-core/listener-control';
import { listenerStop } from '@ctlflow/crossfire-kernel/lifecycle';
import { createDaemonClient, operations as daemonOperations } from '@ctlflow/fleet-daemon-client/client';
import { startDaemon } from '../apps/daemon/src/main.js';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
function createListenerControl(acknowledge: Parameters<typeof listenerControl>[0]) {
  return listenerControl(acknowledge, () => ({ fleetId: '11111111-1111-4111-8111-111111111111', connectionId: '22222222-2222-4222-8222-222222222222', credential: 'fixture-controller-lease' }));
}
function runtimeFixture(input: { sessionId: string; signal: AbortSignal; control: Running['control']; pointer: RuntimeAttachment;
  close: Running['close']; nativeState?: Running['nativeState']; resume?: Running['resume'] }): Running {
  const nativeState: Running['nativeState'] = input.nativeState ?? (() => ({ phase: 'running', lastActivityAt: 1, historyAvailable: true }));
  return { sessionId: input.sessionId, signal: input.signal, control: input.control, nativeState, close: input.close,
    resume: input.resume ?? (async () => success(undefined)),
    attachment: async () => nativeState().phase === 'running' ? success(input.pointer) : failure('conflict', 'Resume this sleeping session explicitly to attach'),
    attachments: async () => nativeState().phase === 'running' ? success([{ context: 'shared', attachment: input.pointer }]) : failure('conflict', 'No live native endpoint'),
    contexts: async () => success([{ context: 'shared', runtime: input.pointer.runtime, sessionId: input.sessionId }]) };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert(Date.now() < deadline, 'Controller observation deadline exceeded'); await yieldLoop(); }
}
function fixture(execution?: Partial<Execution>) {
  const directory = mkdtempSync(join(tmpdir(), 'fc-')), root = join(directory, 'controller'), fleet = join(directory, 'fleet');
  mkdirSync(join(fleet, 'agents', 'analyst'), { recursive: true, mode: 0o700 });
  const definition = join(fleet, 'agents', 'analyst');
  writeFileSync(join(definition, 'agent.toml'), 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\nsandbox_mode = "read-only"\napproval_policy = "never"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Inspect project inputs.', { mode: 0o600 });
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "research"\n[coordination]\nadapter = "crossfire"\nserver = "http://127.0.0.1:8098"\nowner = "@owner:test"\n[[instances]]\nkey = "analyst"\nname = "analyst"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/analyst"\n', { mode: 0o600 });
  const closed: string[] = [], started: string[] = [];
  const registry = createRegistry(root), services = { registry, controller: { name: 'desktop' }, now: Date.now, id: randomUUID,
    delay: (_milliseconds: number, signal: AbortSignal) => new Promise<void>(resolve => {
      if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
    }),
    execution: { connect: () => success(undefined), connection: () => ({ connected: true, deliveryEnabled: true, revision: 0, error: null }),
      delivery: async () => failure('unavailable', 'Not connected'), message: async () => failure('unavailable', 'Not connected'), disconnect: async () => {}, close: async () => {},
      validate: () => success(undefined), inspect: async () => success(undefined), test: async () => success(undefined), prepare: async () => success(undefined), remove: async () => success(undefined),
      archive: async () => success(undefined), update: async () => success(undefined),
      reset: async () => success(undefined),
      contexts: async () => success([]), confirmStopped: async () => success(undefined),
      start: async (_configuration, instance) => { started.push(instance.key); const stop = new AbortController(), sessionId = 'native-session-' + randomUUID(); return success(runtimeFixture({ sessionId, signal: stop.signal,
        pointer: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: { endpoint: 'ws://127.0.0.1:12345', tokenFile: '/fixture/private-token' } }, control: createListenerControl(async () => {}).connection,
        close: async () => { closed.push(instance.key); stop.abort(); } })); }, ...execution } satisfies Execution };
  const controller = value(createController(services)), record = value(controller.add(fleet));
  async function operation(action: 'enroll' | 'start' | 'stop' | 'reset', instanceKey?: string) {
    const current = value(controller.view(record.fleetId));
    return value(await controller.operate({ operationId: randomUUID(), action, target: instanceKey ? { kind: 'agent', fleetId: record.fleetId, instanceKey } : { kind: 'fleet', fleetId: record.fleetId }, expectedRevision: current.revision }));
  }
  async function finish(operation: Operation) {
    await until(() => ['failed', 'succeeded'].includes(value(controller.operation(operation.operationId)).status));
    return value(controller.operation(operation.operationId));
  }
  return { controller, services, registry, directory, fleet, definition, record, closed, started, operation, finish };
}

test('enrollment reviews a stopped fleet without starting, resetting or enabling delivery', async scope => {
  const calls: string[] = [];
  const fixture = fixtureController({ prepare: async (_configuration, _controller, intent, _signal, approval) => {
    calls.push('prepare:' + intent); approval({ url: 'https://example.test/manage/enrollments/review', code: 'ABCDEF123456' });
    return success(undefined);
  }, reset: async () => { calls.push('reset'); return success(undefined); },
  delivery: async () => { calls.push('delivery'); return failure('conflict', 'Enrollment must never change delivery'); } });
  cleanup(scope, () => fixture.controller.close());
  const enrolled = await fixture.finish(await fixture.operation('enroll'));
  assert.equal(enrolled.status, 'succeeded');
  assert.deepEqual(calls, ['prepare:enroll']);
  assert.deepEqual(fixture.started, []);
  const current = value(fixture.controller.view(fixture.record.fleetId));
  assert.equal(current.phase, 'stopped');
  assert.equal(current.instances[0]!.desiredActive, false);
  assert.equal(current.instances[0]!.listenerActive, false);
  assert.deepEqual(value(fixture.registry.desiredIntent()), []);
  assert.equal((await fixture.controller.operate({ operationId: randomUUID(), action: 'enroll',
    target: { kind: 'agent', fleetId: current.fleetId, instanceKey: 'analyst' }, expectedRevision: current.revision })).ok, false);
  await fixture.finish(await fixture.operation('start'));
  assert.equal((await fixture.controller.operate({ operationId: randomUUID(), action: 'enroll',
    target: { kind: 'fleet', fleetId: current.fleetId }, expectedRevision: value(fixture.controller.view(current.fleetId)).revision })).ok, false);
  await fixture.finish(await fixture.operation('stop'));
  const session = value(fixture.controller.view(current.fleetId)).instances[0]!.sessionId;
  await fixture.finish(await fixture.operation('enroll'));
  assert.equal(value(fixture.controller.view(current.fleetId)).instances[0]!.sessionId, session);
  assert.equal(fixture.started.length, 1);
  assert.deepEqual(calls, ['prepare:enroll', 'prepare:resume', 'prepare:enroll']);
});

test('rosters are strict, disjoint and bounded; empty stopped fleets and persistent work areas are valid', () => {
  const roster = { fleet: 'team', coordination: { adapter: 'crossfire', server: 'https://example.test', owner: '@owner:test' }, instances: [] };
  assert(validateRoster(roster).ok);
  assert.equal(validateRoster({ ...roster, extra: true }).ok, false);
  const instance = { key: 'one', name: 'one', definition: 'new-role', workarea: 'agents/original/workarea/one' };
  assert(validateRoster({ ...roster, instances: [instance] }).ok);
  for (const workarea of ['../escape', '/escape', 'agents/original/workarea/../escape', 'agents/original/workarea']) assert.equal(validateRoster({ ...roster, instances: [{ ...instance, workarea }] }).ok, false);
  assert.equal(validateRoster({ ...roster, instances: [instance, { ...instance, key: 'two', name: 'two', workarea: instance.workarea + '/nested' }] }).ok, false);
  assert.equal(parseToml('fleet = "one"\nfleet = "two"', validateRoster).ok, false);
});

test('controller owns runtimes, rejects duplicates and operation reuse with different input', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  assert.equal(fixture.controller.add(fixture.fleet).ok, false);
  const start = await fixture.operation('start'); assert.equal((await fixture.finish(start)).status, 'succeeded');
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).phase, 'running');
  const { operationId, target, action, expectedRevision } = start;
  assert.equal(value(await fixture.controller.operate({ expectedRevision, action, target, operationId })).operationId, operationId);
  assert.equal((await fixture.controller.operate({ expectedRevision, action: 'stop', target, operationId })).ok, false);
  assert.equal((await fixture.finish(await fixture.operation('start'))).status, 'succeeded'); assert.equal(fixture.started.length, 1);
  writeFileSync(join(fixture.definition, 'AGENTS.md'), 'Updated role while running.');
  assert.equal((await fixture.finish(await fixture.operation('stop'))).status, 'succeeded', 'Disk edits cannot prevent stopping the running deployment');
  assert.equal(fixture.closed.length, 1); assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 0);
});
const fixtureController = fixture;

test('automatic recovery closes the exact failed generation, retains deployed configuration and stops on explicit intent', async scope => {
  const native: AbortController[] = [], calls: string[] = [], waits: { milliseconds: number; release: () => void }[] = [];
  const fixture = fixtureController({ start: async (_configuration, _instance, _signal, reason) => {
    calls.push(reason); const stop = new AbortController(); native.push(stop);
    return success(runtimeFixture({ sessionId: 'retained-native-session', signal: stop.signal, control: createListenerControl(async () => {}).connection,
      pointer: { runtime: 'fixture', sessionId: 'retained-native-session', workspace: '/fixture', connection: {} },
      close: async () => { stop.abort(); } }));
  } }); cleanup(scope, () => fixture.controller.close());
  fixture.services.delay = async (milliseconds, signal) => new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const release = () => { signal.removeEventListener('abort', release); resolve(); };
    waits.push({ milliseconds, release }); signal.addEventListener('abort', release, { once: true });
  });
  await fixture.finish(await fixture.operation('start'));
  native[0]!.abort(new Error('Original native disconnect'));
  await until(() => waits.length > 0);
  assert.equal(waits[0]!.milliseconds, 1000);
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).instances[0]!.error, 'Original native disconnect');
  writeFileSync(join(fixture.definition, 'AGENTS.md'), 'Disk edits must not retarget recovery.');
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 0);
  assert.equal((await fixture.controller.remove(fixture.record.fleetId, 0)).ok, false);
  waits[0]!.release(); await until(() => calls.length >= 2);
  assert.deepEqual(calls, ['operator', 'recovery']);
  await until(() => value(fixture.controller.view(fixture.record.fleetId)).phase === 'running');
  native[1]!.abort(new Error('Second native disconnect')); await until(() => waits.length >= 2);
  assert.equal((await fixture.finish(await fixture.operation('stop'))).status, 'succeeded');
  waits[1]!.release(); await yieldLoop(); assert.equal(calls.length, 2);
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 0);
});

test('owner disconnect is intentional, stops the owned generation and never automatically restarts it', async scope => {
  const stop = new AbortController();
  let starts = 0, closes = 0, waits = 0;
  const fixture = fixtureController({ start: async () => {
    starts++;
    return success(runtimeFixture({ sessionId: 'retained', signal: stop.signal, control: createListenerControl(async () => {}).connection,
      pointer: { runtime: 'fixture', sessionId: 'retained', workspace: '/fixture', connection: {} },
      close: async () => { closes++; } }));
  } }); cleanup(scope, () => fixture.controller.close());
  fixture.services.delay = async () => { waits++; };
  await fixture.finish(await fixture.operation('start'));
  stop.abort(listenerStop('The owner requested this listener to disconnect'));
  await until(() => value(fixture.controller.view(fixture.record.fleetId)).phase === 'stopped');
  assert.equal(starts, 1); assert.equal(closes, 1); assert.equal(waits, 0);
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).instances[0]!.error, null);
});

test('transport cancellation recovers desired listeners with exact history and preserves explicit stops', async scope => {
  for (const reason of [new DOMException('Connection canceled', 'AbortError'), new DOMException('Connection timed out', 'TimeoutError'),
    Object.assign(new Error('Connection canceled'), { code: 'ABORT_ERR' }), Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' })]) {
    const native: AbortController[] = [], calls: string[] = [], waits: { milliseconds: number; release(): void }[] = [];
    const fixture = fixtureController({ start: async (_configuration, instance, _signal, mode) => {
      calls.push(mode + ':' + instance.key); const stop = new AbortController(); native.push(stop);
      return success(runtimeFixture({ sessionId: 'retained-native-history', signal: stop.signal, control: createListenerControl(async () => {}).connection,
        pointer: { runtime: 'fixture', sessionId: 'retained-native-history', workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } }));
    } }); cleanup(scope, () => fixture.controller.close());
    fixture.services.delay = async (milliseconds, signal) => new Promise<void>(resolve => {
      const release = () => { signal.removeEventListener('abort', release); resolve(); };
      waits.push({ milliseconds, release }); if (signal.aborted) release(); else signal.addEventListener('abort', release, { once: true });
    });
    value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: {
      key: 'stopped-peer', name: 'stopped-peer', definition: 'analyst', workarea: 'agents/analyst/workarea/stopped-peer' } }));
    await fixture.finish(await fixture.operation('start', 'analyst'));
    native[0]!.abort(reason); await until(() => waits.length === 1);
    assert.equal(waits[0]!.milliseconds, 1000); waits[0]!.release();
    await until(() => value(fixture.controller.view(fixture.record.fleetId)).instances[0]!.phase === 'running');
    const current = value(fixture.controller.view(fixture.record.fleetId));
    assert.deepEqual(calls, ['operator:analyst', 'recovery:analyst']);
    assert.equal(current.instances[0]!.sessionId, 'retained-native-history'); assert.equal(current.instances[0]!.desiredActive, true);
    assert.equal(current.instances[1]!.desiredActive, false); assert.equal(current.instances[1]!.listenerActive, false);
  }
});

test('explicit context reset closes the owned process before reset and retains identity and configured startup', async scope => {
  const calls: string[] = [], sessions: string[] = [];
  const fixture = fixtureController({ reset: async (_configuration, instance) => { calls.push('reset-' + instance.key); return success(undefined); },
    start: async (_configuration, instance) => { const stop = new AbortController(); calls.push('start-' + instance.key); const sessionId = randomUUID(); sessions.push(sessionId);
      return success(runtimeFixture({ sessionId, signal: stop.signal, control: createListenerControl(async () => {}).connection,
        pointer: { runtime: 'fixture', workspace: '/fixture', sessionId, connection: {} }, close: async () => { calls.push('close-' + instance.key); stop.abort(); } })); } });
  cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start'));
  const reset = await fixture.operation('reset', 'analyst'); assert.equal((await fixture.finish(reset)).status, 'succeeded');
  assert.deepEqual(calls, ['start-analyst', 'close-analyst', 'reset-analyst', 'start-analyst']); assert.notEqual(sessions[0], sessions[1]);
  assert.equal((await fixture.finish(await fixture.operation('reset'))).status, 'succeeded');
  assert.deepEqual(calls.slice(-3), ['close-analyst', 'reset-analyst', 'start-analyst']);
});

test('reset inspects exactly the selected instances before stopping or archiving any native history', async scope => {
  const inspected: string[][] = []; let reject = true;
  const fixture = fixtureController({ inspect: async (_configuration, _signal, instances) => {
    assert(instances); inspected.push(instances.map(instance => instance.key));
    return reject ? failure('invalid', 'Selected model does not support max effort') : success(undefined);
  } }); cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: {
    key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  await fixture.finish(await fixture.operation('start'));
  const before = value(fixture.controller.view(fixture.record.fleetId));
  const rejected = await fixture.finish(await fixture.operation('reset', 'analyst'));
  assert.equal(rejected.status, 'failed'); assert.equal(rejected.errors[0]!.code, 'invalid');
  assert.deepEqual(fixture.closed, []); assert.equal(fixture.started.length, 2);
  assert.deepEqual(value(fixture.controller.view(fixture.record.fleetId)).instances.map(instance => instance.sessionId),
    before.instances.map(instance => instance.sessionId));
  assert.deepEqual(inspected, [['analyst']]); reject = false;
  assert.equal((await fixture.finish(await fixture.operation('reset', 'analyst'))).status, 'succeeded');
  assert.deepEqual(inspected, [['analyst'], ['analyst']]); assert.deepEqual(fixture.closed, ['analyst']);
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).instances.find(instance => instance.instance.key === 'peer')!.sessionId,
    before.instances.find(instance => instance.instance.key === 'peer')!.sessionId);
});

test('fleet fresh history stops all targets before reset and reports partial failure without restarting failed peers', async scope => {
  const calls: string[] = [];
  const fixture = fixtureController({ reset: async (_configuration, instance) => {
    calls.push('reset-' + instance.key); return instance.key === 'analyst' ? failure('missing', 'Missing authorized reset export') : success(undefined);
  }, start: async (_configuration, instance) => {
    calls.push('start-' + instance.key); const stop = new AbortController();
    return success(runtimeFixture({ sessionId: randomUUID(), signal: stop.signal, control: createListenerControl(async () => {}).connection,
      pointer: { runtime: 'fixture', sessionId: randomUUID(), workspace: '/fixture', connection: {} },
      close: async () => { calls.push('close-' + instance.key); stop.abort(); } }));
  } }); cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  await fixture.finish(await fixture.operation('start')); calls.length = 0;
  const operation = await fixture.finish(await fixture.operation('reset'));
  assert.equal(operation.status, 'failed'); assert.equal(operation.errors[0]!.instanceKey, 'analyst');
  assert.deepEqual(calls, ['close-analyst', 'close-peer', 'reset-analyst', 'reset-peer', 'start-peer']);
  const state = value(fixture.controller.view(fixture.record.fleetId));
  assert.equal(state.instances.find(item => item.instance.key === 'analyst')!.phase, 'failed');
  assert.equal(state.instances.find(item => item.instance.key === 'peer')!.phase, 'running');
});

for (const action of ['stop', 'reset'] as const) test('fleet ' + action + ' isolates cleanup failures and never resets a process whose stop failed', async scope => {
  const calls: string[] = []; let cleanupFails = true;
  const fixture = fixtureController({ reset: async (_configuration, instance) => { calls.push('reset-' + instance.key); return success(undefined); },
    start: async (_configuration, instance) => {
      calls.push('start-' + instance.key); const stop = new AbortController(), sessionId = randomUUID();
      return success(runtimeFixture({ sessionId, signal: stop.signal, control: createListenerControl(async () => {}).connection,
        pointer: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: {} }, close: async () => {
          calls.push('close-' + instance.key);
          if (cleanupFails && instance.key === 'analyst') throw new Error('Exact owned process could not be cleaned up');
          stop.abort();
        } }));
    } });
  cleanup(scope, async () => { cleanupFails = false; await fixture.controller.close(); });
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  await fixture.finish(await fixture.operation('start')); calls.length = 0;
  const result = await fixture.finish(await fixture.operation(action));
  assert.equal(result.status, 'failed'); assert.equal(result.errors.length, 1); assert.equal(result.errors[0]!.instanceKey, 'analyst');
  assert.deepEqual(calls, action === 'stop' ? ['close-analyst', 'close-peer'] : ['close-analyst', 'close-peer', 'reset-peer', 'start-peer']);
  const states = value(fixture.controller.view(fixture.record.fleetId)).instances;
  assert.equal(states.find(instance => instance.instance.key === 'analyst')?.phase, 'failed');
  assert.equal(states.find(instance => instance.instance.key === 'peer')?.phase, action === 'stop' ? 'stopped' : 'running');
});

test('remote commands use the same native lifecycle journal and retain uncertain reset identities across history pruning and restart', async scope => {
  let control: Parameters<Execution['connect']>[2] | undefined, resets = 0;
  const fixture = fixtureController({ connect: (_configuration, _signal, incoming) => { control = incoming; return success(undefined); },
    reset: async () => { resets++; return success(undefined); } });
  cleanup(scope, () => fixture.controller.close()); assert(control);
  const command = { operationId: randomUUID(), instanceKey: 'analyst', action: 'reset' as const };
  assert.equal(value(await control.execute(command)).status, 'succeeded');
  assert.equal(value(await control.execute(command)).status, 'succeeded'); assert.equal(resets, 1);
  const pinned = value(fixture.controller.operation(command.operationId)); assert.equal(pinned.receiptPending, true);
  await fixture.controller.close();
  const past: Operation[] = Array.from({ length: 400 }, () => ({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: fixture.record.fleetId },
    expectedRevision: 0, status: 'succeeded', createdAt: 1, completedAt: 2, approval: null, errors: [] }));
  for (const operation of [pinned, ...past]) value(fixture.registry.saveOperation(operation));
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); assert(control);
  const stop = value(await restarted.operate({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 }));
  await until(() => value(restarted.operation(stop.operationId)).completedAt !== null);
  assert.equal(value(restarted.operation(command.operationId)).receiptPending, true, 'Ordinary CLI retention must not evict an uncertain remote reset');
  assert.equal(value(await control.execute(command)).status, 'succeeded'); assert.equal(resets, 1, 'Reconnecting may retrieve the exact outcome, never repeat reset');
  value(control.acknowledged(command.operationId)); assert.equal(value(restarted.operation(command.operationId)).receiptPending, undefined);
});

test('an interrupted remote operation becomes a recorded failure, never an automatic second fresh-history action', async scope => {
  let control: Parameters<Execution['connect']>[2] | undefined, resets = 0;
  const fixture = fixtureController({ connect: (_configuration, _signal, incoming) => { control = incoming; return success(undefined); },
    reset: async () => { resets++; return success(undefined); } });
  await fixture.controller.close();
  const interrupted: Operation = { operationId: randomUUID(), action: 'reset', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0,
    receiptPending: true, status: 'running', createdAt: 1, completedAt: null, approval: null, errors: [] };
  value(fixture.registry.saveOperation(interrupted));
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); assert(control);
  const result = value(await control.execute({ operationId: interrupted.operationId, action: 'reset', instanceKey: null }));
  assert.equal(result.status, 'failed'); assert(result.errorMessage?.includes('Controller stopped')); assert.equal(resets, 0);
});

test('delivery deactivation retains owned engines and unregister closes the control connection', async scope => {
  const binding = createListenerControl(async () => {}); binding.update({ active: true, input: null });
  let enabled = true, disconnected = false;
  const fixture = fixtureController({ connection: () => ({ connected: true, deliveryEnabled: enabled, revision: 4, error: null }),
    delivery: async (_configuration, input) => { enabled = input.enabled; binding.update({ active: enabled, input: null });
      return success({ fleetId: randomUUID(), revision: input.expectedRevision + 1, deliveryEnabled: enabled, connection: { status: 'online', lastSeenAt: 1 } }); },
    start: async () => { const stop = new AbortController(); return success(runtimeFixture({ sessionId: 'unchanged', signal: stop.signal,
      control: binding.connection, pointer: { runtime: 'fixture', sessionId: 'unchanged', workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } })); },
    disconnect: async () => { disconnected = true; binding.close(); } });
  cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start'));
  const fleetId = fixture.record.fleetId;
  assert.equal(value(fixture.controller.view(fleetId)).instances[0]!.listenerActive, true);
  value(await fixture.controller.delivery(fleetId, { expectedRevision: 4, enabled: false }));
  const paused = value(fixture.controller.view(fleetId));
  assert.equal(paused.phase, 'running'); assert.equal(paused.instances[0]!.listenerActive, false); assert.equal(paused.instances[0]!.sessionId, 'unchanged');
  value(await fixture.controller.delivery(fleetId, { expectedRevision: 5, enabled: true }));
  assert.equal(value(fixture.controller.view(fleetId)).instances[0]!.listenerActive, true);
  binding.close(); assert.equal(value(fixture.controller.view(fleetId)).instances[0]!.listenerActive, false);
  await fixture.finish(await fixture.operation('stop'));
  value(await fixture.controller.remove(fleetId, value(fixture.controller.view(fleetId)).revision)); assert(disconnected);
});

test('terminal pointers exist only for live instances and never leak into registry views', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  const fleetId = fixture.record.fleetId;
  assert.equal((await fixture.controller.attachment(fleetId, 'analyst')).ok, false);
  assert.equal((await fixture.controller.attachment(fleetId, 'missing')).ok, false);
  assert.equal((await fixture.controller.attachment(randomUUID(), 'analyst')).ok, false);
  await fixture.finish(await fixture.operation('start'));
  const pointer = value((await fixture.controller.attachment(fleetId, 'analyst')));
  const current = value(fixture.controller.view(fleetId));
  assert.equal(pointer.sessionId, current.instances[0]!.sessionId);
  assert(fleetView(current).ok, 'Daemon views preserve opaque runtime-native session IDs');
  for (const sessionId of ['', 'x'.repeat(201), 'unsafe\nidentity']) assert.equal(instanceView({ ...current.instances[0], sessionId }).ok, false);
  pointer.connection.tokenFile = '/changed-by-caller';
  assert.equal(value((await fixture.controller.attachment(fleetId, 'analyst'))).connection.tokenFile, '/fixture/private-token');
  const operationDirectory = join(fixture.directory, 'controller', 'operations');
  const storedOperations = readdirSync(operationDirectory).map(file => JSON.parse(readFileSync(join(operationDirectory, file), 'utf8')) as unknown);
  for (const view of [fixture.controller.list(), fixture.controller.view(fleetId), fixture.registry.registrations(), storedOperations]) {
    assert(!JSON.stringify(view).includes('/fixture/private-token'));
    assert(!JSON.stringify(view).includes('ws://127.0.0.1:12345'));
  }
  await fixture.finish(await fixture.operation('stop'));
  assert.equal((await fixture.controller.attachment(fleetId, 'analyst')).ok, false);
  await fixture.finish(await fixture.operation('start'));
  assert.notEqual(value((await fixture.controller.attachment(fleetId, 'analyst'))).sessionId, pointer.sessionId);
});

test('approval waiting is model-free and stop cancels a pending start', async scope => {
  const fixture = fixtureController({ prepare: async (_config, _controller, _intent, signal, approval) => {
    approval({ url: 'http://127.0.0.1/manage/enrollments/test', code: 'ABCDEF123456' });
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    return failure('unavailable', 'Cancelled');
  } }); cleanup(scope, () => fixture.controller.close());
  const start = await fixture.operation('start');
  await until(() => value(fixture.controller.operation(start.operationId)).status === 'awaiting-approval');
  const stop = await fixture.operation('stop'); assert.equal((await fixture.finish(stop)).status, 'succeeded');
  assert.equal((await fixture.finish(start)).status, 'failed'); assert.deepEqual(fixture.started, []);
});

test('roster edits serialize registration retirement and retain files when removing the last instance', async scope => {
  let release!: () => void;
  const fixture = fixtureController({ remove: async () => { await new Promise<void>(resolve => { release = resolve; }); return success(undefined); } });
  cleanup(scope, () => fixture.controller.close());
  const pending = fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'remove', instanceKey: 'analyst' });
  assert.equal((await fixture.controller.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 })).ok, false);
  assert.equal(fixture.controller.rename(fixture.record.fleetId, 0, 'Raced').ok, false);
  release(); assert.deepEqual(value(await pending).instances, []);
  assert.equal(value(fixture.registry.load(fixture.fleet)).roster.instances.length, 0);
  const rebooted = value(createController(fixture.services)); cleanup(scope, () => rebooted.close());
  assert.equal(value(rebooted.list()).length, 1); assert.deepEqual(value(rebooted.view(fixture.record.fleetId)).instances, []);
});

test('an enrollment collision refuses the entire fleet without native startup or desired activation', async scope => {
  const fixture = fixtureController({ prepare: async () => failure('name_collision', 'Name collision: analyst') });
  cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  const operation = await fixture.finish(await fixture.operation('start'));
  assert.equal(operation.status, 'failed');
  assert.deepEqual(operation.errors, [{ instanceKey: null, code: 'name_collision', message: 'Name collision: analyst' }]);
  assert.deepEqual(fixture.started, []);
  assert.deepEqual(value(fixture.registry.desiredIntent()), []);
  assert(value(fixture.controller.view(fixture.record.fleetId)).instances.every(instance => !instance.desiredActive));
});

test('native per-instance failure retains successful peers; startup history survives controller restart', async scope => {
  const fixture = fixtureController();
  const start = fixture.services.execution.start;
  fixture.services.execution.start = async (...args) => args[1].key === 'analyst' ? failure('invalid', 'Native settings unavailable') : start(...args);
  cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  const operation = await fixture.operation('start'); const result = await fixture.finish(operation);
  assert.equal(result.status, 'failed'); assert.equal(result.errors[0]?.code, 'invalid'); assert.deepEqual(fixture.started, ['peer']);
  await fixture.controller.close(); assert.deepEqual(fixture.closed, ['peer']);
  const reopened = value(createController(fixture.services)); cleanup(scope, () => reopened.close());
  assert.equal(value(reopened.operation(operation.operationId)).status, 'failed');
  await reopened.ready();
  const recovered = value(reopened.view(fixture.record.fleetId));
  assert.equal(recovered.instances.find(instance => instance.instance.key === 'analyst')!.phase, 'failed');
  assert.equal(recovered.instances.find(instance => instance.instance.key === 'peer')!.phase, 'running');
});

test('runtime failures retain their cause, become inactive immediately and cannot restart during cleanup', async scope => {
  const stops = new Map<string, AbortController>(), closed: string[] = [];
  let release!: () => void;
  const cleaning = new Promise<void>(resolve => { release = resolve; });
  const fixture = fixtureController({ start: async (_configuration, instance) => {
    const stop = new AbortController(), control = createListenerControl(async () => {});
    control.update({ active: true, input: null }); stops.set(instance.key, stop);
    return success(runtimeFixture({ sessionId: 'native-' + instance.key, signal: stop.signal, control: control.connection,
      pointer: { runtime: 'fixture', sessionId: 'native-' + instance.key, workspace: '/fixture', connection: {} },
      close: async () => { if (instance.key === 'analyst') await cleaning; closed.push(instance.key); stop.abort(); } }));
  } });
  cleanup(scope, async () => { release(); await fixture.controller.close(); });
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  await fixture.finish(await fixture.operation('start'));
  const fleetId = fixture.record.fleetId;
  stops.get('analyst')!.abort(new Error('Native approval route lost access'));
  const failed = value(fixture.controller.view(fleetId));
  assert.equal(failed.instances[0]!.error, 'Native approval route lost access');
  assert.equal(failed.instances[0]!.listenerActive, false);
  assert.equal(failed.instances[1]!.listenerActive, true);
  assert.equal(failed.instances[1]!.phase, 'running');
  const raced = await fixture.controller.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'agent', fleetId, instanceKey: 'analyst' }, expectedRevision: failed.revision });
  assert.equal(raced.ok, false);
  release(); await cleaning; await yieldLoop(); assert(closed.includes('analyst'));
  assert.equal(value(fixture.controller.view(fleetId)).instances[0]!.error, 'Native approval route lost access');
  assert.equal((await fixture.finish(await fixture.operation('start', 'analyst'))).status, 'succeeded');
});

test('runtime cleanup failure is secondary to the original disconnect cause', async scope => {
  const stop = new AbortController(); let cleanupFails = true;
  const fixture = fixtureController({ start: async () => success(runtimeFixture({ sessionId: 'native', signal: stop.signal,
    pointer: { runtime: 'fixture', sessionId: 'native', workspace: '/fixture', connection: {} }, control: createListenerControl(async () => {}).connection,
    close: async () => { if (cleanupFails) throw new Error('Private engine close failed'); } })) });
  cleanup(scope, async () => { cleanupFails = false; await fixture.controller.close(); });
  await fixture.finish(await fixture.operation('start'));
  stop.abort(new Error('Selected thread closed'));
  await yieldLoop();
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).instances[0]!.error, 'Selected thread closed; cleanup: Private engine close failed');
  const refused = await fixture.controller.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 });
  assert(!refused.ok); assert.equal(refused.error.code, 'conflict');
});

test('inspection never accepts edited configuration; a revision-checked start applies it exactly once', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.controller.ready();
  const file = join(fixture.directory, 'controller', 'fleets.json'), before = readFileSync(file);
  const registered = value(fixture.registry.registrations())[0]!;
  writeFileSync(join(fixture.definition, 'AGENTS.md'), 'An explicit reviewed configuration change.', { mode: 0o600 });
  for (let inspection = 0; inspection < 3; inspection++) {
    assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 0);
    assert.equal(value(fixture.controller.list())[0]!.revision, 0);
    assert.deepEqual(value(await fixture.controller.contexts(fixture.record.fleetId, 'analyst')), []);
  }
  assert(readFileSync(file).equals(before)); assert.deepEqual(value(fixture.registry.registrations()), [registered]);
  const stale = await fixture.controller.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 1 });
  assert(!stale.ok); assert.equal(stale.error.code, 'stale_revision'); assert(readFileSync(file).equals(before));
  await fixture.finish(await fixture.operation('start'));
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 1);
  assert.notEqual(value(fixture.registry.registrations())[0]!.digest, registered.digest);
  await fixture.finish(await fixture.operation('stop')); await fixture.finish(await fixture.operation('start'));
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 1);
});

test('sleeping and waking native phases retain the listener and inspection never resumes them', async scope => {
  const binding = createListenerControl(async () => {}); binding.update({ active: true, input: null });
  let phase: NativeSessionState['phase'] = 'sleeping', starts = 0, stoppedReads = 0;
  const fixture = fixtureController({ contexts: async () => { stoppedReads++; return success([{ context: 'shared', runtime: 'fixture', sessionId: 'saved' }]); },
    start: async () => { starts++; const stop = new AbortController(); return success(runtimeFixture({ sessionId: 'saved', signal: stop.signal,
      nativeState: () => ({ phase, lastActivityAt: 123, historyAvailable: true }), control: binding.connection,
      pointer: { runtime: 'fixture', sessionId: 'saved', workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } })); } });
  cleanup(scope, () => fixture.controller.close());
  assert.deepEqual(value(await fixture.controller.contexts(fixture.record.fleetId, 'analyst')), [{ context: 'shared', runtime: 'fixture', sessionId: 'saved' }]);
  assert.equal(starts, 0); assert.equal(stoppedReads, 1);
  await fixture.finish(await fixture.operation('start'));
  for (const next of ['sleeping', 'waking', 'running'] as const) {
    phase = next;
    const state = value(fixture.controller.view(fixture.record.fleetId)); assert(fleetView(state).ok);
    assert.equal(state.phase, next); assert.equal(state.instances[0]!.phase, next);
    assert.equal(state.instances[0]!.listenerActive, true); assert.equal(state.instances[0]!.desiredActive, true);
    assert.equal(state.instances[0]!.lastActivityAt, 123); assert.equal(state.instances[0]!.historyAvailable, true);
    assert.equal(value(await fixture.controller.contexts(fixture.record.fleetId, 'analyst'))[0]!.sessionId, 'saved');
    const pointer = await fixture.controller.attachment(fixture.record.fleetId, 'analyst');
    assert.equal(pointer.ok, next === 'running');
    if (!pointer.ok) assert.equal(pointer.error.code, 'conflict');
  }
  assert.equal(starts, 1); assert.equal(stoppedReads, 1);
});

test('explicit start wakes a sleeping native generation without replacing its binding or reenrolling', async scope => {
  const binding = createListenerControl(async () => {}); binding.update({ active: false, input: null });
  let phase: NativeSessionState['phase'] = 'sleeping', starts = 0, resumes = 0, deny = false;
  const fixture = fixtureController({ start: async () => {
    starts++; const stop = new AbortController();
    return success(runtimeFixture({ sessionId: 'exact-saved', signal: stop.signal, control: binding.connection,
      pointer: { runtime: 'fixture', sessionId: 'exact-saved', workspace: '/fixture', connection: {} },
      nativeState: () => ({ phase, lastActivityAt: 123, historyAvailable: true }),
      resume: async () => { resumes++; if (deny) return failure('conflict', 'Cleanup is unverified'); phase = 'running'; return success(undefined); },
      close: async () => { stop.abort(); } }));
  } });
  cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start'));
  await fixture.finish(await fixture.operation('start'));
  const state = value(fixture.controller.view(fixture.record.fleetId));
  assert.equal(state.instances[0]!.phase, 'running'); assert.equal(state.instances[0]!.sessionId, 'exact-saved');
  assert.equal(state.instances[0]!.listenerActive, false, 'Native resume cannot change fleet delivery authority');
  assert.equal(starts, 1); assert.equal(resumes, 1);
  phase = 'sleeping'; deny = true;
  const refused = await fixture.finish(await fixture.operation('start'));
  assert.equal(refused.status, 'failed'); assert.equal(refused.errors[0]!.code, 'conflict');
  assert.equal(starts, 1); assert.equal(resumes, 2);
});

test('desired bindings restore exact histories without enrollment and explicit stops remain stopped across restart', async scope => {
  const calls: string[] = [], sessions = new Map<string, string>(); let preparations = 0;
  const fixture = fixtureController({ prepare: async () => { preparations++; return success(undefined); },
    start: async (_configuration, instance, _signal, reason) => {
      const sessionId = sessions.get(instance.key) ?? randomUUID(); sessions.set(instance.key, sessionId); calls.push(reason + ':' + instance.key);
      const stop = new AbortController(); return success(runtimeFixture({ sessionId, signal: stop.signal,
        control: createListenerControl(async () => {}).connection, pointer: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: {} },
        close: async () => { stop.abort(); } }));
    } }); cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  await fixture.finish(await fixture.operation('start')); await fixture.finish(await fixture.operation('stop', 'analyst'));
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'peer' }]);
  await fixture.controller.close();
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'peer' }]);
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); await restarted.ready();
  assert.deepEqual(calls, ['operator:analyst', 'operator:peer', 'recovery:peer']); assert.equal(preparations, 1);
  const states = value(restarted.view(fixture.record.fleetId)).instances;
  assert.equal(states[0]!.phase, 'stopped'); assert.equal(states[0]!.desiredActive, false);
  assert.equal(states[1]!.sessionId, sessions.get('peer')); assert.equal(states[1]!.desiredActive, true);
});

test('thrown restoration and retry failures retain their transient or permanent classification', async scope => {
  for (const recoverable of [true, false]) {
    const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
    await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
    let attempts = 0;
    const waits: { milliseconds: number; release(): void }[] = [];
    fixture.services.delay = async (milliseconds, signal) => new Promise<void>(resolve => {
      const release = () => { signal.removeEventListener('abort', release); resolve(); };
      waits.push({ milliseconds, release });
      if (signal.aborted) release(); else signal.addEventListener('abort', release, { once: true });
    });
    fixture.services.execution.start = async (_configuration, _instance, _signal, mode) => {
      assert.equal(mode, 'recovery'); attempts++;
      if (attempts <= 2) throw Object.assign(new Error('Exact restoration failure'), { code: recoverable ? 'ABORT_ERR' : 'forbidden' });
      const stop = new AbortController();
      return success(runtimeFixture({ sessionId: 'retained-native-history', signal: stop.signal, control: createListenerControl(async () => {}).connection,
        pointer: { runtime: 'fixture', sessionId: 'retained-native-history', workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } }));
    };
    const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); await restarted.ready();
    if (recoverable) {
      await until(() => waits.length === 1); assert.equal(waits[0]!.milliseconds, 1000); waits[0]!.release();
      await until(() => waits.length === 2); assert.equal(attempts, 2); assert.equal(waits[1]!.milliseconds, 2000); waits[1]!.release();
      await until(() => value(restarted.view(fixture.record.fleetId)).phase === 'running');
      assert.equal(attempts, 3); assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.sessionId, 'retained-native-history');
    } else {
      await yieldLoop(); assert.equal(attempts, 1); assert.deepEqual(waits, []);
      assert.equal(value(restarted.view(fixture.record.fleetId)).phase, 'failed');
      assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.error, 'Exact restoration failure');
    }
    assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.desiredActive, true);
  }
});

test('desired intent must reach durable storage before activation and before explicit stop cleanup', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  const save = fixture.registry.saveDesiredIntent;
  fixture.registry.saveDesiredIntent = () => failure('unavailable', 'Private intent storage is unavailable');
  assert.equal((await fixture.finish(await fixture.operation('start'))).status, 'failed'); assert.deepEqual(fixture.started, []);
  fixture.registry.saveDesiredIntent = save;
  await fixture.finish(await fixture.operation('start'));
  fixture.registry.saveDesiredIntent = () => failure('unavailable', 'Private intent storage is unavailable');
  const refused = await fixture.controller.operate({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 });
  assert(!refused.ok); assert.equal(refused.error.code, 'unavailable'); assert.deepEqual(fixture.closed, []);
  assert.equal(value(fixture.controller.view(fixture.record.fleetId)).instances[0]!.desiredActive, true);
  fixture.registry.saveDesiredIntent = save;
  await fixture.finish(await fixture.operation('stop'));
  assert.deepEqual(value(fixture.registry.desiredIntent()), []); assert.deepEqual(fixture.closed, ['analyst']);
});

test('a permanent restoration failure preserves desired intent without spinning or accepting unreviewed files', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let starts = 0;
  fixture.services.execution.start = async () => { starts++; return failure('conflict', 'Installed listener needs an explicit update'); };
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); await restarted.ready(); await yieldLoop();
  assert.equal(starts, 1);
  const state = value(restarted.view(fixture.record.fleetId)).instances[0]!;
  assert.equal(state.phase, 'failed'); assert.equal(state.desiredActive, true); assert.equal(state.listenerActive, false);
  assert.equal(state.error, 'Installed listener needs an explicit update');
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'analyst' }]);
  await restarted.close(); writeFileSync(join(fixture.definition, 'AGENTS.md'), 'Unaccepted disk change.', { mode: 0o600 });
  const edited = value(createController(fixture.services)); cleanup(scope, () => edited.close()); await edited.ready();
  assert.equal(starts, 1); assert.equal(value(edited.view(fixture.record.fleetId)).revision, 0);
  assert.equal(value(edited.view(fixture.record.fleetId)).instances[0]!.desiredActive, true);
});

test('slow startup receipt confirmation preserves the exact generation without a whole-restoration deadline', { timeout: 5000 }, async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let finish!: (result: Result<Running>) => void, starting!: AbortSignal, closed = 0, now = 0;
  const waits: { due: number; release(): void }[] = [];
  fixture.services.now = () => now;
  fixture.services.delay = async (milliseconds, signal) => new Promise<void>(resolve => {
    waits.push({ due: now + milliseconds, release: resolve });
    if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  fixture.services.execution.start = async (_configuration, _instance, signal) => new Promise<Result<Running>>(resolve => { starting = signal; finish = resolve; });
  const restarted = value(createController(fixture.services)); cleanup(scope, async () => { finish?.(failure('unavailable', 'Controlled test ended')); await restarted.close(); });
  let ready = false; const restoration = restarted.ready().then(() => { ready = true; });
  await until(() => finish !== undefined);
  now = 180000; for (const wait of waits.filter(wait => wait.due <= now)) wait.release(); await yieldLoop();
  assert.equal(starting.aborted, false, 'Elapsed time cannot cancel waiting for the original native input');
  const state = value(restarted.view(fixture.record.fleetId)).instances[0]!;
  assert.equal(state.phase, 'starting'); assert.equal(state.desiredActive, true); assert.equal(state.error, null);
  assert.equal(ready, false); assert.equal(waits.length, 0);
  const stop = new AbortController();
  finish(success(runtimeFixture({ sessionId: 'retained-native-history', signal: stop.signal, control: createListenerControl(async () => {}).connection,
    pointer: { runtime: 'fixture', sessionId: 'retained-native-history', workspace: '/fixture', connection: {} }, close: async () => { closed++; stop.abort(); } })));
  await restoration;
  assert.equal(closed, 0); assert.equal(value(restarted.view(fixture.record.fleetId)).phase, 'running');
  assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.sessionId, 'retained-native-history');
});

test('cancelled restoration cleanup failure retains its exact generation and blocks replacement', { timeout: 5000 }, async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let finish!: (result: Result<Running>) => void, starting!: AbortSignal, cleanupFails = true, recoveryWaits = 0;
  fixture.services.delay = async (_milliseconds, signal) => new Promise<void>(resolve => {
    recoveryWaits++;
    if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  fixture.services.execution.start = async (_configuration, _instance, signal) => new Promise<Result<Running>>(resolve => { starting = signal; finish = resolve; });
  const restarted = value(createController(fixture.services)); cleanup(scope, async () => { cleanupFails = false; await restarted.close(); });
  await until(() => finish !== undefined);
  const update = value(await restarted.operate({ operationId: randomUUID(), action: 'update', releaseDirectory: '/owned/release',
    target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 }));
  await until(() => starting.aborted);
  const stop = new AbortController();
  finish(success(runtimeFixture({ sessionId: 'uncleaned', signal: stop.signal, control: createListenerControl(async () => {}).connection,
    pointer: { runtime: 'fixture', sessionId: 'uncleaned', workspace: '/fixture', connection: {} },
    close: async () => { if (cleanupFails) throw new Error('Late native generation cleanup failed'); stop.abort(); } })));
  await until(() => value(restarted.operation(update.operationId)).completedAt !== null); await restarted.ready();
  assert.equal(value(restarted.operation(update.operationId)).status, 'failed');
  assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.error, 'Late native generation cleanup failed');
  assert.equal(recoveryWaits, 0);
  const refused = await restarted.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 });
  assert(!refused.ok); assert.equal(refused.error.code, 'conflict');
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'analyst' }]);
});

test('a slow permanent restoration failure retains its actual error and does not retry', { timeout: 5000 }, async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let finish!: (result: Result<Running>) => void, recoveryWaits = 0;
  fixture.services.delay = async (_milliseconds, signal) => new Promise<void>(resolve => {
    recoveryWaits++;
    if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  fixture.services.execution.start = async () => new Promise<Result<Running>>(resolve => { finish = resolve; });
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close());
  await until(() => finish !== undefined); await yieldLoop();
  assert.equal(value(restarted.view(fixture.record.fleetId)).phase, 'starting');
  finish(failure('invalid', 'Saved native identity is invalid'));
  await restarted.ready();
  assert.equal(value(restarted.view(fixture.record.fleetId)).instances[0]!.error, 'Saved native identity is invalid');
  assert.equal(recoveryWaits, 0);
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'analyst' }]);
});

test('shutdown drains pending restoration even if roster files become invalid and retains desired intent', { timeout: 5000 }, async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let finish!: (result: Result<Running>) => void, executionClosed = false, nativeClosed = false;
  fixture.services.execution.start = async () => new Promise<Result<Running>>(resolve => { finish = resolve; });
  fixture.services.execution.close = async () => { executionClosed = true; };
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close());
  await until(() => finish !== undefined);
  writeFileSync(join(fixture.fleet, 'runtime.toml'), 'invalid TOML');
  const closing = restarted.close(); await yieldLoop(); assert.equal(executionClosed, false);
  const stop = new AbortController();
  finish(success(runtimeFixture({ sessionId: 'late-owned', signal: stop.signal, control: createListenerControl(async () => {}).connection,
    pointer: { runtime: 'fixture', sessionId: 'late-owned', workspace: '/fixture', connection: {} }, close: async () => { nativeClosed = true; stop.abort(); } })));
  await closing; assert.equal(nativeClosed, true); assert.equal(executionClosed, true);
  assert.deepEqual(value(fixture.registry.desiredIntent()), [{ fleetId: fixture.record.fleetId, instanceKey: 'analyst' }]);
});

test('invalid desired state fails closed instead of silently forgetting activation', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  writeFileSync(join(fixture.directory, 'controller', 'desired-intent.json'), '{bad-json', { mode: 0o600 });
  const invalid = createController(fixture.services); assert(!invalid.ok);
  rmSync(join(fixture.directory, 'controller', 'desired-intent.json'));
  value(fixture.registry.saveDesiredIntent([{ fleetId: randomUUID(), instanceKey: 'analyst' }]));
  const orphan = createController(fixture.services); assert(!orphan.ok); assert.equal(orphan.error.code, 'invalid');
});

test('explicit stop does not depend on valid roster files and clears desired keys missing from edited files', async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  await fixture.finish(await fixture.operation('start'));
  const roster = join(fixture.fleet, 'runtime.toml'), original = readFileSync(roster);
  writeFileSync(roster, 'not valid TOML', { mode: 0o600 });
  const stopped = value(await fixture.controller.operate({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 }));
  assert.equal((await fixture.finish(stopped)).status, 'succeeded'); assert.deepEqual(fixture.closed, ['analyst']); assert.deepEqual(value(fixture.registry.desiredIntent()), []);
  writeFileSync(roster, original, { mode: 0o600 }); await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  writeFileSync(roster, 'fleet = "research"\ninstances = []\n[coordination]\nadapter = "crossfire"\nserver = "http://127.0.0.1:8098"\nowner = "@owner:test"\n', { mode: 0o600 });
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close()); await restarted.ready();
  assert(value(restarted.view(fixture.record.fleetId)).error?.includes('missing'));
  const clear = value(await restarted.operate({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 }));
  await until(() => value(restarted.operation(clear.operationId)).completedAt !== null);
  assert.equal(value(restarted.operation(clear.operationId)).status, 'succeeded'); assert.deepEqual(value(fixture.registry.desiredIntent()), []);
});

test('late preparation success after an explicit stop cannot restore activation intent or start a runtime', async scope => {
  let release!: () => void;
  const fixture = fixtureController({ prepare: async () => {
    await new Promise<void>(resolve => { release = resolve; }); return success(undefined);
  } }); cleanup(scope, () => fixture.controller.close());
  const starting = await fixture.operation('start'); await until(() => release !== undefined);
  const stopping = await fixture.operation('stop'); release();
  assert.equal((await fixture.finish(starting)).status, 'failed'); assert.equal((await fixture.finish(stopping)).status, 'succeeded');
  assert.deepEqual(fixture.started, []); assert.deepEqual(value(fixture.registry.desiredIntent()), []);
});

test('startup restoration uses at most four concurrent starts and never reenrolls the persisted roster', { timeout: 5000 }, async scope => {
  const fixture = fixtureController(); cleanup(scope, () => fixture.controller.close());
  for (let index = 1; index < 8; index++) {
    const key = 'peer-' + index, revision = value(fixture.controller.view(fixture.record.fleetId)).revision;
    value(await fixture.controller.editInstance(fixture.record.fleetId, revision, { kind: 'add', instance: { key, name: key, definition: 'analyst', workarea: 'agents/analyst/workarea/' + key } }));
  }
  await fixture.finish(await fixture.operation('start')); await fixture.controller.close();
  let active = 0, maximum = 0; const pending: (() => void)[] = [];
  fixture.services.execution.prepare = async () => assert.fail('Restoration must not reenroll or approve a roster');
  fixture.services.execution.start = async (_configuration, instance, _signal, reason) => {
    assert.equal(reason, 'recovery'); active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => { pending.push(resolve); }); active--;
    const stop = new AbortController(); return success(runtimeFixture({ sessionId: instance.key, signal: stop.signal,
      control: createListenerControl(async () => {}).connection, pointer: { runtime: 'fixture', sessionId: instance.key, workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } }));
  };
  const restarted = value(createController(fixture.services)); cleanup(scope, () => restarted.close());
  await until(() => pending.length === 4); assert.equal(maximum, 4);
  for (const complete of pending.slice(0, 4)) complete();
  await until(() => pending.length === 8); assert.equal(maximum, 4);
  for (const complete of pending.slice(4)) complete();
  await restarted.ready(); assert.equal(active, 0); assert.equal(value(restarted.view(fixture.record.fleetId)).instances.filter(item => item.desiredActive).length, 8);
});

test('explicit update owns queued restoration and cannot start duplicate generations or publish stale lock errors', { timeout: 5000 }, async scope => {
  const current = fixtureController(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  for (let index = 1; index < 8; index++) {
    const instanceKey = 'queued-' + index, revision = value(current.controller.view(current.record.fleetId)).revision;
    value(await current.controller.editInstance(current.record.fleetId, revision, { kind: 'add', instance: { key: instanceKey, name: instanceKey,
      definition: 'analyst', workarea: 'agents/analyst/workarea/' + instanceKey } }));
  }
  await current.finish(await current.operation('start')); await current.controller.close();
  const start = current.services.execution.start;
  let restorations = 0, updates = 0;
  current.services.execution.start = async (...input) => {
    if (input[3] === 'recovery') {
      restorations++;
      await new Promise<void>(resolve => { if (input[2].aborted) resolve(); else input[2].addEventListener('abort', () => resolve(), { once: true }); });
      return failure('conflict', 'Cancelled restoration must not overwrite its replacement');
    }
    return start(...input);
  };
  current.services.execution.update = async () => { updates++; return success(undefined); };
  const restarted = value(createController(current.services)); cleanup(scope, () => restarted.close());
  await until(() => restorations === 4);
  const operation = value(await restarted.operate({ operationId: randomUUID(), action: 'update', releaseDirectory: '/owned/release',
    target: { kind: 'fleet', fleetId: current.record.fleetId }, expectedRevision: current.record.revision + 7 }));
  await until(() => value(restarted.operation(operation.operationId)).completedAt !== null);
  await restarted.ready();
  assert.equal(value(restarted.operation(operation.operationId)).status, 'succeeded');
  assert.equal(restorations, 4, 'Retired queued restoration cannot compete after update resumes its native generation');
  assert.equal(updates, 8);
  const instances = value(restarted.view(current.record.fleetId)).instances;
  assert.equal(instances.every(instance => instance.phase === 'running' && instance.error === null && instance.desiredActive), true);
});

test('fleet stop remembers only enabled agents across daemon restart, repeated stop and partial manual resumes', async scope => {
  const current = fixtureController(); cleanup(scope, () => current.controller.close());
  for (const instanceKey of ['peer', 'deliberately-off']) value(await current.controller.editInstance(current.record.fleetId,
    value(current.controller.view(current.record.fleetId)).revision, { kind: 'add', instance: { key: instanceKey, name: instanceKey,
      definition: 'analyst', workarea: 'agents/analyst/workarea/' + instanceKey } }));
  await current.finish(await current.operation('start', 'analyst')); await current.finish(await current.operation('start', 'peer'));
  await current.finish(await current.operation('stop'));
  assert.deepEqual(value(current.controller.view(current.record.fleetId)).resumeInstanceKeys, ['analyst', 'peer']);
  await current.finish(await current.operation('stop')); await current.controller.close();
  const restarted = value(createController(current.services)); cleanup(scope, () => restarted.close()); await restarted.ready();
  async function operate(action: 'start' | 'stop', instanceKey?: string) {
    const operation = value(await restarted.operate({ operationId: randomUUID(), action, target: instanceKey
      ? { kind: 'agent', fleetId: current.record.fleetId, instanceKey } : { kind: 'fleet', fleetId: current.record.fleetId },
      expectedRevision: value(restarted.view(current.record.fleetId)).revision }));
    await until(() => value(restarted.operation(operation.operationId)).completedAt !== null);
    assert.equal(value(restarted.operation(operation.operationId)).status, 'succeeded');
  }
  await operate('start', 'analyst'); await operate('start');
  assert.deepEqual(value(restarted.view(current.record.fleetId)).instances.filter(item => item.desiredActive).map(item => item.instance.key), ['analyst', 'peer']);
  await operate('stop', 'peer'); await operate('start');
  assert.deepEqual(value(restarted.view(current.record.fleetId)).instances.filter(item => item.desiredActive).map(item => item.instance.key), ['analyst']);
  assert.equal(current.started.includes('deliberately-off'), false);
});

test('empty saved selection cannot silently start manually stopped agents and save failures leave intent unchanged', async scope => {
  const current = fixtureController(); cleanup(scope, () => current.controller.close());
  await current.finish(await current.operation('start')); await current.finish(await current.operation('stop', 'analyst'));
  assert.deepEqual(value(current.controller.view(current.record.fleetId)).resumeInstanceKeys, []);
  const starts = current.started.length; await current.finish(await current.operation('start'));
  assert.equal(current.started.length, starts); assert.deepEqual(value(current.registry.desiredIntent()), []);
  await current.finish(await current.operation('start', 'analyst'));
  current.services.registry.saveResumeSelections = () => failure('unavailable', 'Controlled selection persistence failure');
  const attempted = await current.controller.operate({ operationId: randomUUID(), action: 'stop', target: { kind: 'fleet', fleetId: current.record.fleetId },
    expectedRevision: value(current.controller.view(current.record.fleetId)).revision });
  assert.equal(attempted.ok, false); assert.equal(value(current.controller.view(current.record.fleetId)).instances[0]!.desiredActive, true);
  assert.equal(value(current.controller.view(current.record.fleetId)).instances[0]!.phase, 'running');
});

test('private controller API stays responsive while resource-bounded restoration is queued and explicit stop cancels it without enrollment', { timeout: 5000 }, async scope => {
  const current = fixtureController(); cleanup(scope, () => rmSync(current.directory, { recursive: true })); cleanup(scope, () => current.controller.close());
  for (let index = 1; index < 8; index++) {
    const key = 'queued-' + index, revision = value(current.controller.view(current.record.fleetId)).revision;
    value(await current.controller.editInstance(current.record.fleetId, revision, { kind: 'add', instance: { key, name: key, definition: 'analyst', workarea: 'agents/analyst/workarea/' + key } }));
  }
  await current.finish(await current.operation('start')); await current.controller.close();
  let started = 0, released = false; const completions = new Set<() => void>();
  current.services.execution.prepare = async () => assert.fail('Restoration cannot reenroll a fleet');
  current.services.execution.start = async (_configuration, _instance, signal, reason) => {
    assert.equal(reason, 'recovery'); started++;
    await new Promise<void>(resolve => {
      const complete = () => { completions.delete(complete); signal.removeEventListener('abort', complete); resolve(); };
      if (released || signal.aborted) complete(); else { completions.add(complete); signal.addEventListener('abort', complete, { once: true }); }
    });
    return failure('unavailable', 'Controlled native restoration stopped');
  };
  const starting = startDaemon(join(current.directory, 'controller'), 'desktop', current.services.execution);
  cleanup(scope, async () => { released = true; for (const complete of completions) complete(); await (await starting).close(); });
  const daemon = await starting, client = createDaemonClient(daemon.socketPath);
  await until(() => started === 4);
  assert.equal(value(await client.call(daemonOperations.status, {}, {})).data.stopping, false);
  const restoring = value(await client.call(daemonOperations.fleet, { fleetId: current.record.fleetId }, {})).data;
  assert.equal(restoring.instances.filter(instance => instance.desiredActive && instance.phase === 'starting').length, 8);
  assert.equal((await client.call(daemonOperations.readiness, { fleetId: current.record.fleetId }, {})).ok, false, 'API availability does not claim native listener readiness');
  const stopping = value(await client.call(daemonOperations.operate, {}, { operationId: randomUUID(), action: 'stop',
    target: { kind: 'fleet', fleetId: current.record.fleetId }, expectedRevision: restoring.revision })).data;
  await until(() => value(daemon.controller.operation(stopping.operationId)).completedAt !== null);
  assert.equal(value(daemon.controller.operation(stopping.operationId)).status, 'succeeded');
  const stopped = value(await client.call(daemonOperations.fleet, { fleetId: current.record.fleetId }, {})).data;
  assert.equal(stopped.instances.filter(instance => !instance.desiredActive && instance.phase === 'stopped').length, 8);
  assert.deepEqual(value(current.registry.desiredIntent()), []); assert.equal(started, 4, 'Queued native generations never start after explicit stop');
});
