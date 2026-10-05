import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { resolveWakePolicy } from '../wake/resolve-policy.js';
export function deliveryPolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>, actor: Actor, agentId: string) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!policy.ok) return policy;
  if (!policy.value) return failure('unavailable', 'Instance delivery policy is not initialized');
  const grants = services.collection.roomGrants({ agentId }), applied = services.collection.agentRoomApplications({ agentId }), wake = resolveWakePolicy(services, target.value);
  if (!grants.ok) return grants; if (!applied.ok) return applied; if (!wake.ok) return wake;
  const joined = new Map(applied.value.filter(record => record.membership === 'join' && record.errorCode === null).map(record => [record.roomId, record]));
  const conversation = services.repositories.ownerConversation.find({ agentId });
  if (!conversation.ok) return conversation;
  const eligible = grants.value.filter(grant => grant.accessMode !== 'none'
    && joined.get(grant.roomId)?.observedGeneration === grant.generation);
  if (conversation.value && target.value.principal.status === 'active' && target.value.owner.status === 'active'
    && !eligible.some(grant => grant.roomId === conversation.value?.roomId && grant.accessMode === 'reply' && !grant.muted)) {
    return failure('unavailable', 'The established private owner conversation is not ready');
  }
  return success({ record: target.value, grants: eligible, wake: wake.value, maxMessageBytes: policy.value.maxMessageBytes,
    fleetIdleTimeoutSeconds: policy.value.fleetIdleTimeoutSeconds,
    ownerConversation: conversation.value && eligible.some(grant => grant.roomId === conversation.value?.roomId)
      ? conversation.value.roomId : null });
}
