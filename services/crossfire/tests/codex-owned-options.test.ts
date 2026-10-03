import assert from 'node:assert/strict';
import test from 'node:test';
import { codexRuntime } from '@crossfire/adapter-codex/owned';
import { success } from '@crossfire/kernel/result';
import { ownedVersion, ownedQuestionCapability } from '@crossfire/adapter-codex/owned-options';

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

test('native question configuration checks the actual binary capability before process startup', () => {
  assert(ownedVersion('codex-cli 0.158.0').ok);
  assert(ownedVersion('codex-cli 0.159.2').ok);
  assert(ownedVersion('codex-cli 0.160.0').ok);
  assert(ownedVersion('codex-cli 1.0.0').ok);
  for (const version of ['codex-cli 0.157.9', 'unexpected version']) assert.equal(ownedVersion(version).ok, false);
  for (const listing of ['default_mode_request_user_input\tunder development\tfalse\n',
    'unrelated stable true\ndefault_mode_request_user_input stable true\n']) assert(ownedQuestionCapability(listing).ok);
  const unsupported = ownedQuestionCapability('unrelated stable true\n');
  assert(!unsupported.ok && unsupported.error.message.includes('features.default_mode_request_user_input'));
  for (const listing of ['default_mode_request_user_input false', 'default_mode_request_user_input stable unknown',
    'default_mode_request_user_input stable true\ndefault_mode_request_user_input stable false']) assert.equal(ownedQuestionCapability(listing).ok, false);
  assert(codexRuntime().validate({ features: { default_mode_request_user_input: true } }).ok);
  for (const input of [{ features: { unknown_feature: true } }, { features: { default_mode_request_user_input: 'true' } }]) {
    assert.equal(codexRuntime().validate(input).ok, false);
  }
});
