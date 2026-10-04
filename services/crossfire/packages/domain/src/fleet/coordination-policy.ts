import { failure, success } from '@crossfire/kernel/result';
import type { Agent } from '../identity/types.js';

export type CoordinationPolicy = {
  wakeMode: Agent['wakeMode'];
  senderMatrixIds: string[];
  permissions: 'room.agent.invite'[];
};

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
