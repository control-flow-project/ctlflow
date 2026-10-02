import * as check from '@crossfire/contracts/schema/validation';
import { failure, success } from '@crossfire/kernel/result';
import { approvalRouting } from './permission-policy.js';

const options = check.object({
  model: check.optional(check.text(200)),
  model_reasoning_effort: check.optional(check.choice('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra')),
  sandbox_mode: check.optional(check.choice('read-only', 'workspace-write', 'danger-full-access')),
  approval_policy: check.optional(check.choice('untrusted', 'on-failure', 'on-request', 'never')),
  dangerously_bypass_approvals_and_sandbox: check.optional(check.boolean),
});

export function ownedOptions(input: unknown) {
  const parsed = options(input);
  if (!parsed.ok) return parsed;
  const selected = parsed.value;
  if (selected.dangerously_bypass_approvals_and_sandbox === true && (selected.sandbox_mode !== undefined && selected.sandbox_mode !== 'danger-full-access'
    || selected.approval_policy !== undefined && selected.approval_policy !== 'never')) {
    return failure('invalid', 'dangerously_bypass_approvals_and_sandbox requires danger-full-access and never; remove conflicting sandbox or approval settings');
  }
  const native = { ...(selected.model ? { model: selected.model } : {}),
    ...(selected.model_reasoning_effort ? { model_reasoning_effort: selected.model_reasoning_effort } : {}),
    sandbox_mode: selected.dangerously_bypass_approvals_and_sandbox ? 'danger-full-access' as const : selected.sandbox_mode ?? 'danger-full-access',
    approval_policy: selected.dangerously_bypass_approvals_and_sandbox ? 'never' as const : selected.approval_policy ?? 'on-request' };
  const approval = approvalRouting(native.approval_policy);
  return approval.ok ? success({ options: native, approval: approval.value }) : approval;
}
