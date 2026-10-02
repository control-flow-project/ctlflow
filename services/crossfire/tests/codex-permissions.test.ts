import assert from 'node:assert/strict';
import test from 'node:test';
import { codexPermission } from '@crossfire/adapter-codex/approval';
import type { NativeRequest } from '@crossfire/adapter-codex/protocol';
import { approvalRouting } from '@crossfire/adapter-codex/permission-policy';
import { success } from '@crossfire/kernel/result';

const request: NativeRequest = { id: 'request', method: 'item/commandExecution/requestApproval', params: {
  threadId: 'session', turnId: 'turn', itemId: 'item', command: 'npm install', cwd: '/work',
  availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
} };

test('native approval choices, scope and structured amendments stay exact', () => {
  const approved = codexPermission(request, 'session');
  assert(approved.ok);
  assert.deepEqual(approved.value.scope, request.params);
  assert.deepEqual(approved.value.choices.map(choice => choice.value), ['accept', 'acceptForSession', 'decline', 'cancel'].map(decision => ({ decision })));
  const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'install'] } };
  const network = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.org', action: 'allow' } } };
  const structured = codexPermission({ ...request, params: { ...request.params, availableDecisions: [amendment, network, 'cancel'] } }, 'session');
  assert(structured.ok);
  assert.deepEqual(structured.value.choices[0]?.value, { decision: amendment });
  assert.deepEqual(structured.value.choices[1]?.value, { decision: network });
  const multiline = codexPermission({ ...request, params: { ...request.params, command: 'npm install\nnpm run build' } }, 'session');
  assert(multiline.ok);
  const numeric = codexPermission({ ...request, id: 1 }, 'session');
  const string = codexPermission({ ...request, id: '1' }, 'session');
  assert(numeric.ok && string.ok);
  assert.notEqual(numeric.value.request, string.value.request);
});

test('wrong session, unavailable scope and unclassified choices cannot solicit approval', () => {
  assert.equal(codexPermission(request, 'other').ok, false);
  for (const invalid of [undefined, [], ['accept', 'accept'], ['unknown'], [{ acceptWithExecpolicyAmendment: {} }]]) {
    assert.equal(codexPermission({ ...request, params: { ...request.params, availableDecisions: invalid } }, 'session').ok, false);
  }
  const file = { ...request, method: 'item/fileChange/requestApproval' };
  assert.equal(codexPermission(file, 'session').ok, false);
  const changes = [{ path: '/work/file.ts', diff: '+content', kind: { type: 'add' } }];
  const decoded = codexPermission(file, 'session', changes);
  assert(decoded.ok);
  assert.deepEqual(decoded.value.scope, { request: file.params, changes });
  assert.equal(codexPermission({ ...request, method: 'item/tool/call' }, 'session').ok, false);
  assert.equal(codexPermission({ ...request, params: { ...request.params, command: 'x'.repeat(12_000) } }, 'session').ok, false);
});

test('native effective approval policy determines readiness without a no-approval default', () => {
  assert.deepEqual(approvalRouting('never'), success('none'));
  for (const policy of ['on-request', 'untrusted', 'on-failure']) assert.deepEqual(approvalRouting(policy), success('listener'));
  const granular = { sandbox_approval: false, rules: false, skill_approval: false, request_permissions: false, mcp_elicitations: false };
  assert.deepEqual(approvalRouting({ granular }), success('none'));
  for (const key of Object.keys(granular)) assert.deepEqual(approvalRouting({ granular: { ...granular, [key]: true } }), success('listener'));
  for (const invalid of [undefined, null, 'unknown', {}, { granular: {} }, { granular: { ...granular, rules: 1 } }]) assert.equal(approvalRouting(invalid).ok, false);
});
