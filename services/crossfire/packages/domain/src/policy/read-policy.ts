import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
export function readPolicy(services: Pick<Services, 'repositories' | 'directory' | 'clock'>, actor: Actor) {
  const permission = authorize(services, actor, 'principal.read');
  if (!permission.ok) return permission;
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  return policy.ok ? policy.value ? success(policy.value) : failure('unavailable', 'Instance policy is not initialized') : policy;
}
