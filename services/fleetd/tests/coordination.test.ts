import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@crossfire/test-support/cleanup';
import { definition, parseToml } from '@fleetd/contracts/configuration';
import { loadConfiguration } from '@fleetd/storage/configuration';
import { defaultCoordinationPolicy } from '@crossfire/contracts/coordination-policy';

test('role coordination options are separate from native options and strictly validate modes, capabilities and selected identities', () => {
  const native = { name: 'Analyst', runtime: 'codex', runtime_options: { model: 'fixture', native_option: true } };
  assert(definition(native).ok);
  const options = { wake_mode: 'owner-agents', permissions: ['room.agent.invite'] };
  const valid = definition({ ...native, coordination_options: options });
  assert(valid.ok); assert.deepEqual(valid.value.runtime_options, native.runtime_options);
  for (const invalid of [{ ...options, extra: true }, { ...options, wake_mode: 'agents' },
    { ...options, permissions: ['policy.manage'] }, { ...options, permissions: ['room.agent.invite', 'room.agent.invite'] },
    { ...options, sender_matrix_ids: ['@person:test'] }, { ...options, permissions: undefined },
    { ...options, wake_mode: 'selected', sender_matrix_ids: ['@person:test', '@person:test'] },
    { ...options, wake_mode: 'selected', sender_matrix_ids: ['person'] }]) {
    assert.equal(definition({ ...native, coordination_options: invalid }).ok, false);
  }
  const selected = parseToml('name = "Analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "fixture"\n'
    + '[coordination_options]\nwake_mode = "selected"\nsender_matrix_ids = ["@owner:test", "@peer:test"]\npermissions = []\n', definition);
  assert(selected.ok); assert.deepEqual(selected.value.coordination_options!.sender_matrix_ids, ['@owner:test', '@peer:test']);
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
  assert.deepEqual(initial.value.definitions.analyst!.coordinationPolicy, defaultCoordinationPolicy());
  writeFileSync(join(role, 'agent.toml'), source + '[coordination_options]\nwake_mode = "owner-agents"\npermissions = ["room.agent.invite"]\n', { mode: 0o600 });
  const configured = loadConfiguration(directory); assert(configured.ok);
  assert.notEqual(configured.value.digest, initial.value.digest);
  assert.deepEqual(configured.value.definitions.analyst!.coordinationPolicy, { wakeMode: 'owner-agents', senderMatrixIds: [], permissions: ['room.agent.invite'] });
  assert.deepEqual(configured.value.roster.instances.map(instance => configured.value.definitions[instance.definition]!.coordinationPolicy),
    [configured.value.definitions.analyst!.coordinationPolicy, configured.value.definitions.analyst!.coordinationPolicy]);
  assert.deepEqual(configured.value.definitions.analyst!.options, { model: 'fixture' });
});
