import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ProviderState } from '@ctlflow/crossfire-agent-core/owned-runtime';

export function providerState(value: unknown): Result<ProviderState> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('account' in value)
    || !('requiresOpenaiAuth' in value) || typeof value.requiresOpenaiAuth !== 'boolean'
    || value.account !== null && (typeof value.account !== 'object' || Array.isArray(value.account))) {
    return failure('native', 'Native provider metadata is invalid');
  }
  return success(value.account !== null ? 'present' : value.requiresOpenaiAuth ? 'missing' : 'not-required');
}
