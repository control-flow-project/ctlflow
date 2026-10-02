import assert from 'node:assert/strict';
import test from 'node:test';
import { codexRuntime } from '@crossfire/adapter-codex/owned';
import { success } from '@crossfire/kernel/result';

test('owned Codex defaults to full access with owner-routed on-request approval', () => {
  const adapter = codexRuntime();
  assert.deepEqual(adapter.validate({}), success({ options: { sandbox_mode: 'danger-full-access', approval_policy: 'on-request' }, approval: 'listener' }));
  assert.deepEqual(adapter.validate({ dangerously_bypass_approvals_and_sandbox: false }), adapter.validate({}));
  assert.deepEqual(adapter.validate({ dangerously_bypass_approvals_and_sandbox: true }), success({ options: { sandbox_mode: 'danger-full-access', approval_policy: 'never' }, approval: 'none' }));
  const native = { model: 'fixture', model_reasoning_effort: 'high', sandbox_mode: 'workspace-write', approval_policy: 'on-request' };
  assert.deepEqual(adapter.validate(native), success({ options: native, approval: 'listener' }));
  assert.deepEqual(adapter.validate({ ...native, sandbox_mode: 'danger-full-access', approval_policy: 'never', dangerously_bypass_approvals_and_sandbox: true }),
    success({ options: { ...native, sandbox_mode: 'danger-full-access', approval_policy: 'never' }, approval: 'none' }));
});

test('native bypass conflicts and unknown options are rejected instead of silently weakening native policy', () => {
  const adapter = codexRuntime();
  for (const input of [{ dangerously_bypass_approvals_and_sandbox: true, sandbox_mode: 'read-only' },
    { dangerously_bypass_approvals_and_sandbox: true, sandbox_mode: 'workspace-write' },
    { dangerously_bypass_approvals_and_sandbox: true, approval_policy: 'on-request' },
    { dangerously_bypass_approvals_and_sandbox: 'true' }, { sandbox_mode: 'invalid' },
    { approval_policy: 'invalid' }, { endpoint: 'ws://unowned:1234' }, { yolo: true }]) {
    assert.equal(adapter.validate(input).ok, false, JSON.stringify(input));
  }
});
