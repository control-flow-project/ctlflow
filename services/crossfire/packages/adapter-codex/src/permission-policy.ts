import { fields } from '@crossfire/contracts/validation';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { RuntimeApproval } from '@crossfire/agent-core/runtime';

export function approvalRouting(policy: unknown): Result<RuntimeApproval> {
  if (policy === 'never') return success('none');
  if (typeof policy === 'string' && ['untrusted', 'on-request', 'on-failure'].includes(policy)) return success('listener');
  const parsed = fields(policy, ['granular']);
  const granular = parsed.ok ? fields(parsed.value.granular, ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']) : parsed;
  if (!granular.ok || Object.values(granular.value).some(value => typeof value !== 'boolean')) {
    return failure('native', 'Codex did not report a supported native approval policy');
  }
  return success(Object.values(granular.value).some(value => value === true) ? 'listener' : 'none');
}
