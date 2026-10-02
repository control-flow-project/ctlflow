import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createController } from '@fleetd/domain/controller';
import type { Execution } from '@fleetd/domain/port';
import type { Operation } from '@fleetd/domain/model';
import { createRegistry } from '@fleetd/storage/registry';
import { validateRoster, parseToml } from '@fleetd/contracts/configuration';
import { fleetView, instanceView } from '@fleetd/contracts/api';
import { success, failure, type Result } from '@crossfire/kernel/result';
import { createListenerControl } from '@crossfire/agent-core/listener-control';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
function fixture(execution?: Partial<Execution>) {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-test-')), root = join(directory, 'controller'), fleet = join(directory, 'fleet');
  mkdirSync(join(fleet, 'agents', 'analyst'), { recursive: true, mode: 0o700 });
  const definition = join(fleet, 'agents', 'analyst');
  writeFileSync(join(definition, 'agent.toml'), 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\nsandbox_mode = "read-only"\napproval_policy = "never"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Inspect project inputs.', { mode: 0o600 });
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "research"\n[coordination]\nadapter = "crossfire"\nserver = "http://127.0.0.1:8098"\nowner = "@owner:test"\n[[instances]]\nkey = "analyst"\nname = "analyst"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/analyst"\n', { mode: 0o600 });
  const closed: string[] = [], started: string[] = [];
  const registry = createRegistry(root), services = { registry, controller: { name: 'desktop' }, now: Date.now, id: randomUUID,
    execution: { connect: () => success(undefined), connection: () => ({ connected: true, deliveryEnabled: true, revision: 0, error: null }),
      delivery: async () => failure('unavailable', 'Not connected'), message: async () => failure('unavailable', 'Not connected'), disconnect: async () => {}, close: async () => {},
      validate: () => success(undefined), prepare: async () => success({ failed: [] }), detach: async () => success(undefined),
      start: async (_configuration, instance) => { started.push(instance.key); const stop = new AbortController(), sessionId = 'native-session-' + randomUUID(); return success({ sessionId, signal: stop.signal,
        attachment: { runtime: 'fixture', sessionId, workspace: '/fixture', connection: { endpoint: 'ws://127.0.0.1:12345', tokenFile: '/fixture/private-token' } }, control: createListenerControl(async () => {}).connection,
        close: async () => { closed.push(instance.key); stop.abort(); } }); }, ...execution } satisfies Execution };
  const controller = value(createController(services)), record = value(controller.add(fleet));
  async function operation(action: 'start' | 'stop', instanceKey?: string) {
    const current = value(controller.view(record.fleetId));
    return value(await controller.operate({ operationId: randomUUID(), action, target: instanceKey ? { kind: 'agent', fleetId: record.fleetId, instanceKey } : { kind: 'fleet', fleetId: record.fleetId }, expectedRevision: current.revision }));
  }
  async function finish(operation: Operation) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = value(controller.operation(operation.operationId));
      if (current.status === 'failed' || current.status === 'succeeded') return current;
      await delay(10);
    }
    assert.fail('Operation did not finish');
  }
  return { controller, services, registry, directory, fleet, definition, record, closed, started, operation, finish };
}

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
  assert.equal(fixture.closed.length, 1); assert.equal(value(fixture.controller.view(fixture.record.fleetId)).revision, 1);
});
const fixtureController = fixture;

test('delivery deactivation retains owned engines and unregister closes the control connection', async scope => {
  const binding = createListenerControl(async () => {}); binding.update({ active: true, input: null });
  let enabled = true, disconnected = false;
  const fixture = fixtureController({ connection: () => ({ connected: true, deliveryEnabled: enabled, revision: 4, error: null }),
    delivery: async (_configuration, input) => { enabled = input.enabled; binding.update({ active: enabled, input: null });
      return success({ fleetId: randomUUID(), revision: input.expectedRevision + 1, deliveryEnabled: enabled, connection: { status: 'online', lastSeenAt: 1 } }); },
    start: async () => { const stop = new AbortController(); return success({ sessionId: 'unchanged', signal: stop.signal,
      control: binding.connection, attachment: { runtime: 'fixture', sessionId: 'unchanged', workspace: '/fixture', connection: {} }, close: async () => { stop.abort(); } }); },
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
  assert.equal(fixture.controller.attachment(fleetId, 'analyst').ok, false);
  assert.equal(fixture.controller.attachment(fleetId, 'missing').ok, false);
  assert.equal(fixture.controller.attachment(randomUUID(), 'analyst').ok, false);
  await fixture.finish(await fixture.operation('start'));
  const pointer = value(fixture.controller.attachment(fleetId, 'analyst'));
  const current = value(fixture.controller.view(fleetId));
  assert.equal(pointer.sessionId, current.instances[0]!.sessionId);
  assert(fleetView(current).ok, 'Daemon views preserve opaque runtime-native session IDs');
  for (const sessionId of ['', 'x'.repeat(201), 'unsafe\nidentity']) assert.equal(instanceView({ ...current.instances[0], sessionId }).ok, false);
  pointer.connection.tokenFile = '/changed-by-caller';
  assert.equal(value(fixture.controller.attachment(fleetId, 'analyst')).connection.tokenFile, '/fixture/private-token');
  for (const view of [fixture.controller.list(), fixture.controller.view(fleetId), fixture.registry.registrations(), fixture.registry.operations()]) {
    assert(!JSON.stringify(view).includes('/fixture/private-token'));
    assert(!JSON.stringify(view).includes('ws://127.0.0.1:12345'));
  }
  await fixture.finish(await fixture.operation('stop'));
  assert.equal(fixture.controller.attachment(fleetId, 'analyst').ok, false);
  await fixture.finish(await fixture.operation('start'));
  assert.notEqual(value(fixture.controller.attachment(fleetId, 'analyst')).sessionId, pointer.sessionId);
});

test('approval waiting is model-free and stop cancels a pending start', async scope => {
  const fixture = fixtureController({ prepare: async (_config, _controller, signal, approval) => {
    approval({ url: 'http://127.0.0.1/manage/enrollments/test', code: 'ABCDEF123456' });
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    return failure('unavailable', 'Cancelled');
  } }); cleanup(scope, () => fixture.controller.close());
  const start = await fixture.operation('start');
  const approvalDeadline = Date.now() + 5000;
  while (value(fixture.controller.operation(start.operationId)).status !== 'awaiting-approval') {
    assert(Date.now() < approvalDeadline); await delay(10);
  }
  const stop = await fixture.operation('stop'); assert.equal((await fixture.finish(stop)).status, 'succeeded');
  assert.equal((await fixture.finish(start)).status, 'failed'); assert.deepEqual(fixture.started, []);
});

test('roster edits serialize native detachment and retain files when removing the last instance', async scope => {
  let release!: () => void;
  const fixture = fixtureController({ detach: async () => { await new Promise<void>(resolve => { release = resolve; }); return success(undefined); } });
  cleanup(scope, () => fixture.controller.close());
  const pending = fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'remove', instanceKey: 'analyst' });
  assert.equal((await fixture.controller.operate({ operationId: randomUUID(), action: 'start', target: { kind: 'fleet', fleetId: fixture.record.fleetId }, expectedRevision: 0 })).ok, false);
  assert.equal(fixture.controller.rename(fixture.record.fleetId, 0, 'Raced').ok, false);
  release(); assert.deepEqual(value(await pending).instances, []);
  assert.equal(value(fixture.registry.load(fixture.fleet)).roster.instances.length, 0);
  const rebooted = value(createController(fixture.services)); cleanup(scope, () => rebooted.close());
  assert.equal(value(rebooted.list()).length, 1); assert.deepEqual(value(rebooted.view(fixture.record.fleetId)).instances, []);
});

test('per-instance failure retains successful peers; startup history survives controller restart', async scope => {
  const fixture = fixtureController({ prepare: async () => success({ failed: [{ instanceKey: 'analyst', code: 'name_collision', message: 'Name is taken' }] }) });
  cleanup(scope, () => fixture.controller.close());
  value(await fixture.controller.editInstance(fixture.record.fleetId, 0, { kind: 'add', instance: { key: 'peer', name: 'peer', definition: 'analyst', workarea: 'agents/analyst/workarea/peer' } }));
  const operation = await fixture.operation('start'); const result = await fixture.finish(operation);
  assert.equal(result.status, 'failed'); assert.equal(result.errors[0]?.code, 'name_collision'); assert.deepEqual(fixture.started, ['peer']);
  await fixture.controller.close(); assert.deepEqual(fixture.closed, ['peer']);
  const reopened = value(createController(fixture.services)); cleanup(scope, () => reopened.close());
  assert.equal(value(reopened.operation(operation.operationId)).status, 'failed');
  assert(value(reopened.view(fixture.record.fleetId)).instances.every(instance => instance.phase === 'stopped'));
});
