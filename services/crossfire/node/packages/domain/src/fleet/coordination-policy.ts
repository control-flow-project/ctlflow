import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { opaqueIdentifier } from '@ctlflow/crossfire-kernel/identifier';
import type { CoordinationPolicy } from '../coordination/values.js';
export type { CoordinationPolicy } from '../coordination/values.js';

export function validateCoordinationPolicy(policy: CoordinationPolicy) {
  if (!['humans', 'everyone', 'selected'].includes(policy.wakeMode)
    || policy.senders.length > 2000 || new Set(policy.senders.map(sender => sender.backendUserId)).size !== policy.senders.length
    || policy.wakeMode === 'everyone' && policy.senders.length !== 0
    || policy.senders.some(sender => !opaqueIdentifier(sender.backendUserId) || typeof sender.includeAgents !== 'boolean')
    || policy.permissions.length > 1 || policy.permissions.some(code => code !== 'room.agent.invite')) {
    return failure('invalid', 'Supply a valid wake mode, unique selected backend identities and supported room permissions');
  }
  return success(policy);
}
