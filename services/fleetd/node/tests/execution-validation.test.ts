import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecution } from '@ctlflow/fleetd-adapter-execution/execution';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import type { OwnedRuntimeAdapter } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { Configuration } from '@ctlflow/fleetd-domain/model';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { connectMatrix } from '@ctlflow/crossfire-adapter-matrix/connection';

const configuration: Configuration = { directory: '/fixture', digest: 'fixture',
  roster: { fleet: 'fixture', instances: [], coordination: { adapter: 'crossfire', server: 'https://example.test', owner: '@human:example.test' } },
  definitions: { analyst: { name: 'Analyst', runtime: 'codex', instructions: '', coordinationPolicy: defaultCoordinationPolicy('@human:example.test'), options: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } } } };

test('native policies are validated without manual approval-room configuration', () => {
  const execution = createExecution({ codex: codexRuntime() }, connectMatrix, '/fixture/assets', () => {});
  assert.deepEqual(execution.validate(configuration), success(undefined));
  const selected = structuredClone(configuration);
  selected.definitions.analyst!.options.approval_policy = 'never';
  assert.deepEqual(execution.validate(selected), success(undefined));
  selected.definitions.analyst!.options.sandbox_mode = 'invalid';
  assert.equal(execution.validate(selected).ok, false);
});

test('fleet execution consumes adapter capabilities without interpreting native policy keys', () => {
  const adapter: OwnedRuntimeAdapter = {
    configuredSettings: () => [],
    inspect: async () => success(undefined),
    savedContexts: async () => success([]),
    reset: async () => success(undefined),
    validate: input => success({ options: input as Record<string, unknown>, approval: 'listener' }),
    start: async () => failure('native', 'No process is used by validation'),
  };
  const input = structuredClone(configuration);
  input.definitions.analyst!.runtime = 'fixture';
  input.definitions.analyst!.options = { native_setting: 'fixture' };
  assert.deepEqual(createExecution({ fixture: adapter }, connectMatrix, '/fixture/assets', () => {}).validate(input), success(undefined));
  adapter.validate = options => success({ options: options as Record<string, unknown>, approval: 'runtime' });
  assert.deepEqual(createExecution({ fixture: adapter }, connectMatrix, '/fixture/assets', () => {}).validate(input), success(undefined));
});
