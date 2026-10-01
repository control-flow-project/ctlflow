import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';

export function enrollmentCapacity(services: Pick<Services, 'repositories' | 'directory' | 'collection'>, ownerId: string) {
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!policy.ok) return policy;
  if (!policy.value) return failure('unavailable', 'Instance is not initialized');
  const role = services.repositories.principalRole.find({ principalId: ownerId });
  if (!role.ok) return role;
  if (!role.value || role.value.principalKind !== 'human' || !['member', 'administrator'].includes(role.value.roleCode)) {
    return failure('forbidden', 'An enrolled human owner role is required');
  }
  const active = services.directory.activeAgentCount(), owned = services.directory.activeAgentCount(ownerId);
  const pending = services.collection.pendingIdentityCount(), ownedPending = services.collection.pendingIdentityCount(ownerId);
  if (!active.ok) return active;
  if (!owned.ok) return owned;
  if (!pending.ok) return pending;
  if (!ownedPending.ok) return ownedPending;
  const ownerLimit = role.value.roleCode === 'administrator' ? policy.value.maxAgents : policy.value.maxOwnerAgents;
  const instanceCount = active.value + pending.value, ownerCount = owned.value + ownedPending.value;
  return success({ policy: policy.value, ownerLimit, ownerCount, instanceCount,
    remaining: Math.min(policy.value.maxAgents - instanceCount, ownerLimit - ownerCount) });
}
