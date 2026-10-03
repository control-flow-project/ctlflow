import * as check from '@crossfire/contracts/schema/validation';
import { failure, success } from '@crossfire/kernel/result';
import { approvalRouting } from './permission-policy.js';

const options = check.object({
  model: check.optional(check.text(200)),
  model_reasoning_effort: check.optional(check.choice('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra')),
  sandbox_mode: check.optional(check.choice('read-only', 'workspace-write', 'danger-full-access')),
  approval_policy: check.optional(check.choice('untrusted', 'on-failure', 'on-request', 'never')),
  dangerously_bypass_approvals_and_sandbox: check.optional(check.boolean),
  features: check.optional(check.object({ default_mode_request_user_input: check.optional(check.boolean) })),
});

export function ownedVersion(version: string) {
  const matched = /^codex-cli (\d+)\.(\d+)\.(\d+)$/u.exec(version);
  return !matched || Number(matched[1]) === 0 && Number(matched[2]) < 158
    ? failure('invalid', 'Stock Codex 0.158.0 or newer is required')
    : success(undefined);
}

export function ownedQuestionCapability(listing: string) {
  const entries = listing.split('\n').map(line => line.trim().split(/\s+/u))
    .filter(parts => parts[0] === 'default_mode_request_user_input');
  return entries.length === 1 && entries[0]!.length >= 3 && ['true', 'false'].includes(entries[0]!.at(-1)!)
    ? success(undefined)
    : failure('invalid', 'This Codex binary does not expose features.default_mode_request_user_input; install a native release that supports it');
}

export function ownedOptions(input: unknown) {
  const parsed = options(input);
  if (!parsed.ok) return parsed;
  const selected = parsed.value;
  if (selected.dangerously_bypass_approvals_and_sandbox === true && (selected.sandbox_mode !== undefined && selected.sandbox_mode !== 'danger-full-access'
    || selected.approval_policy !== undefined && selected.approval_policy !== 'never')) {
    return failure('invalid', 'dangerously_bypass_approvals_and_sandbox requires danger-full-access and never; remove conflicting sandbox or approval settings');
  }
  const native = { ...(selected.model ? { model: selected.model } : {}),
    ...(selected.features ? { features: selected.features } : {}),
    ...(selected.model_reasoning_effort ? { model_reasoning_effort: selected.model_reasoning_effort } : {}),
    sandbox_mode: selected.dangerously_bypass_approvals_and_sandbox ? 'danger-full-access' as const : selected.sandbox_mode ?? 'danger-full-access',
    approval_policy: selected.dangerously_bypass_approvals_and_sandbox ? 'never' as const : selected.approval_policy ?? 'on-request' };
  const approval = approvalRouting(native.approval_policy);
  return approval.ok ? success({ options: native, approval: approval.value }) : approval;
}
