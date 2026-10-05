import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { CoordinationPolicy } from '../coordination/values.js';
export type { CoordinationPolicy } from '../coordination/values.js';

export function validateCoordinationPolicy(policy: CoordinationPolicy) {
  if (!['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected'].includes(policy.wakeMode)
    || policy.senderMatrixIds.length > 2000 || new Set(policy.senderMatrixIds).size !== policy.senderMatrixIds.length
    || policy.wakeMode !== 'selected' && policy.senderMatrixIds.length !== 0
    || policy.senderMatrixIds.some(id => id.length > 255 || !/^@[^:\s]+:[^\s]+$/u.test(id))
    || policy.permissions.length > 1 || policy.permissions.some(code => code !== 'room.agent.invite')) {
    return failure('invalid', 'Supply a valid wake mode, unique selected Matrix identities and supported room permissions');
  }
  return success(policy);
}
