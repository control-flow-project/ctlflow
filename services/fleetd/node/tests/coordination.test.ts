import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { definition, parseToml } from '@ctlflow/fleetd-contracts/configuration';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { instanceView } from '@ctlflow/fleetd-contracts/api';
import { nativeOptions, type Configuration } from '@ctlflow/fleetd-domain/model';
import { createExecution } from '@ctlflow/fleetd-adapter-execution/execution';
import { connectMatrix } from '@ctlflow/crossfire-adapter-matrix/connection';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';

test('role coordination options are separate from native options and strictly validate modes, capabilities and selected identities', () => {
  const native = { name: 'Analyst', runtime: 'codex', runtime_options: { model: 'fixture', native_option: true } };
  assert(definition(native).ok);
  const options = { wake_mode: 'selected', wake_senders: [{ backend_user_id: '@owner:test', include_agents: true }], permissions: ['room.agent.invite'] };
  const valid = definition({ ...native, coordination_options: options });
  assert(valid.ok); assert.deepEqual(valid.value.runtime_options, native.runtime_options);
  for (const invalid of [{ ...options, extra: true }, { ...options, wake_mode: 'agents' },
    { ...options, permissions: ['policy.manage'] }, { ...options, permissions: ['room.agent.invite', 'room.agent.invite'] },
    { ...options, sender_backend_user_ids: ['@person:test'] }, { ...options, permissions: undefined }, { ...options, wake_mode: 'owner-agents' },
    { ...options, wake_mode: 'everyone' }, { ...options, wake_senders: undefined },
    { ...options, wake_senders: [options.wake_senders[0], options.wake_senders[0]] },
    { ...options, wake_senders: [{ backend_user_id: 'invalid\nidentity', include_agents: true }] },
    { ...options, wake_senders: [{ backend_user_id: '@person:test' }] }]) {
    assert.equal(definition({ ...native, coordination_options: invalid }).ok, false);
  }
  const selected = parseToml('name = "Analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "fixture"\n'
    + '[coordination_options]\nwake_mode = "selected"\npermissions = []\n'
    + '[[coordination_options.wake_senders]]\nbackend_user_id = "@owner:test"\ninclude_agents = true\n'
    + '[[coordination_options.wake_senders]]\nbackend_user_id = "@peer:test"\ninclude_agents = false\n', definition);
  assert(selected.ok); assert.deepEqual(selected.value.coordination_options!.wake_senders,
    [{ backend_user_id: '@owner:test', include_agents: true }, { backend_user_id: '@peer:test', include_agents: false }]);
});

test('all instances inherit one complete role policy and changing it changes the deployed configuration digest', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-policy-')), role = join(directory, 'agents/analyst');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(role, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, 'runtime.toml'), 'fleet = "agreements"\n[coordination]\nadapter = "crossfire"\nserver = "https://example.test"\nowner = "@owner:test"\n'
    + ['ada', 'kit'].map(name => '[[instances]]\nkey = "' + name + '"\nname = "' + name + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/' + name + '"\n').join(''), { mode: 0o600 });
  const source = 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "fixture"\n';
  writeFileSync(join(role, 'agent.toml'), source, { mode: 0o600 });
  writeFileSync(join(role, 'AGENTS.md'), 'Deterministic role fixture.', { mode: 0o600 });
  const initial = loadConfiguration(directory); assert(initial.ok);
  assert.deepEqual(initial.value.definitions.analyst!.coordinationPolicy, defaultCoordinationPolicy('@owner:test'));
  writeFileSync(join(role, 'agent.toml'), source + '[coordination_options]\nwake_mode = "selected"\npermissions = ["room.agent.invite"]\n'
    + '[[coordination_options.wake_senders]]\nbackend_user_id = "@owner:test"\ninclude_agents = true\n', { mode: 0o600 });
  const configured = loadConfiguration(directory); assert(configured.ok);
  assert.notEqual(configured.value.digest, initial.value.digest);
  assert.deepEqual(configured.value.definitions.analyst!.coordinationPolicy,
    { wakeMode: 'selected', senders: [{ backendUserId: '@owner:test', includeAgents: true }], permissions: ['room.agent.invite'] });
  assert.deepEqual(configured.value.roster.instances.map(instance => configured.value.definitions[instance.definition]!.coordinationPolicy),
    [configured.value.definitions.analyst!.coordinationPolicy, configured.value.definitions.analyst!.coordinationPolicy]);
  assert.deepEqual(configured.value.definitions.analyst!.options, Object.assign(Object.create(null), { model: 'fixture' }));
});

test('listener history options have one camelCase domain and API representation with an explicit TOML boundary', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-listener-options-')), role = join(directory, 'agents/analyst');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(role, { recursive: true, mode: 0o700 });
  writeFileSync(join(role, 'agent.toml'), 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\n', { mode: 0o600 });
  writeFileSync(join(role, 'AGENTS.md'), 'History option boundary proof.', { mode: 0o600 });
  const source = 'fleet = "agreements"\n[coordination]\nadapter = "crossfire"\nserver = "https://example.test"\nowner = "@owner:test"\n'
    + '[[instances]]\nkey = "ada"\nname = "ada"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/ada"\n';
  const registry = createRegistry(join(directory, '.registry'));
  for (const historyMode of [undefined, 'shared', 'per-room'] as const) {
    writeFileSync(join(directory, 'runtime.toml'), source + '[instances.listener_options]\n'
      + (historyMode ? 'history_mode = "' + historyMode + '"\n' : ''), { mode: 0o600 });
    const loaded = loadConfiguration(directory); assert(loaded.ok);
    const instance = loaded.value.roster.instances[0]!;
    assert.deepEqual(instance.listenerOptions, historyMode ? { historyMode } : {});
    assert.equal(Object.hasOwn(instance, 'listener_options'), false);
    const view = { instance, phase: 'stopped', listenerActive: false, desiredActive: false, lastActivityAt: null, historyAvailable: null,
      sessionId: null, error: null, startedAt: null };
    assert.equal(instanceView(view).ok, true);
    assert.equal(instanceView({ ...view, instance: { ...instance, listener_options: {} } }).ok, false);
    const written = registry.writeRoster(loaded.value, loaded.value.roster); assert(written.ok);
    assert.deepEqual(written.value.roster, loaded.value.roster);
  }
});

test('native instance options share one role and replace only explicitly selected top-level settings across TOML, registry and preflight', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-native-options-')), role = join(directory, 'agents/analyst');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(role, { recursive: true, mode: 0o700 });
  writeFileSync(join(role, 'agent.toml'), 'name="Analyst"\nruntime="codex"\n[runtime_options]\nmodel="fixture"\nmodel_reasoning_effort="high"\n'
    + 'sandbox_mode="danger-full-access"\napproval_policy="on-request"\n[runtime_options.features]\ndefault_mode_request_user_input=true\n', { mode: 0o600 });
  writeFileSync(join(role, 'AGENTS.md'), 'One complete shared role and skill library.', { mode: 0o600 });
  const source = 'fleet="research"\n[coordination]\nadapter="crossfire"\nserver="https://example.test"\nowner="@owner:test"\n'
    + '[[instances]]\nkey="analyst"\nname="analyst"\ndefinition="analyst"\nworkarea="agents/analyst/workarea/analyst"\n'
    + '[[instances]]\nkey="analyst-fast"\nname="analyst-fast"\ndefinition="analyst"\nworkarea="agents/analyst/workarea/analyst-fast"\n';
  writeFileSync(join(directory, 'runtime.toml'), source + '[instances.runtime_options]\nmodel_reasoning_effort="medium"\n', { mode: 0o600 });
  const loaded = loadConfiguration(directory); assert(loaded.ok);
  assert.equal(Object.keys(loaded.value.definitions).length, 1);
  const [ordinary, fast] = loaded.value.roster.instances;
  const baseline = nativeOptions(loaded.value, ordinary!), selected = nativeOptions(loaded.value, fast!);
  assert.deepEqual(selected, { ...baseline, model_reasoning_effort: 'medium' });
  assert.equal(baseline.model_reasoning_effort, 'high');
  assert.equal(Object.hasOwn(fast!, 'runtime_options'), false);
  assert.deepEqual(nativeOptions(loaded.value, { ...fast!, runtimeOptions: { features: {} } }).features, {}, 'Nested tables replace as one explicit native value, not a second deep-merge policy');
  const view = { instance: fast!, phase: 'stopped', listenerActive: false, desiredActive: false, lastActivityAt: null, historyAvailable: null,
    sessionId: null, error: null, startedAt: null };
  assert(instanceView(view).ok);
  assert.equal(instanceView({ ...view, instance: { ...fast!, runtime_options: {} } }).ok, false);
  const registry = createRegistry(join(directory, '.registry'));
  const written = registry.writeRoster(loaded.value, loaded.value.roster); assert(written.ok);
  assert.deepEqual(written.value.roster, loaded.value.roster);
  const execution = createExecution({ codex: codexRuntime() }, connectMatrix, directory, () => {});
  assert(execution.validate(written.value).ok);
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const configured: Configuration = { ...written.value, roster: { ...written.value.roster, instances: [
      ordinary!, { ...fast!, runtimeOptions: { model_reasoning_effort: effort } } ] } };
    assert(execution.validate(configured).ok, 'Supported native reasoning effort: ' + effort);
    assert.deepEqual(nativeOptions(configured, configured.roster.instances[1]!), { ...baseline, model_reasoning_effort: effort });
  }
  const invalid = { ...written.value, roster: { ...written.value.roster, instances: [
    ordinary!, { ...fast!, runtimeOptions: { model_reasoning_effort: 'made-up' } } ] } };
  assert.equal(execution.validate(invalid).ok, false, 'Every effective instance selection is validated, not only role defaults');
  const inspected: Record<string, unknown>[] = [];
  const adapter = { ...codexRuntime(), inspect: async (input: { options: unknown }) => {
    inspected.push(input.options as Record<string, unknown>); return { ok: true as const, value: undefined };
  } };
  assert((await createExecution({ codex: adapter }, connectMatrix, directory, () => {}).inspect(written.value, new AbortController().signal)).ok);
  assert.deepEqual(inspected, [baseline, selected]);
  writeFileSync(join(directory, 'runtime.toml'), source + '[instances.runtime_options]\nmodel_reasoning_effort="low"\n', { mode: 0o600 });
  const changed = loadConfiguration(directory); assert(changed.ok);
  assert.notEqual(changed.value.digest, loaded.value.digest);
  for (const malformed of ['runtime_options="not-a-table"\n', 'runtimeOptions={}\n', '[instances.coordination_options]\nwake_mode="everyone"\n']) {
    writeFileSync(join(directory, 'runtime.toml'), source + malformed, { mode: 0o600 });
    assert.equal(loadConfiguration(directory).ok, false);
  }
});
