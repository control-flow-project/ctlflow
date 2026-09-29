import { success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { resolveWakePolicy } from '../wake/resolve-policy.js';
export function deliveryPolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>, actor: Actor, agentId: string) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const grants = services.collection.roomGrants({ agentId }), applied = services.collection.agentRoomApplications({ agentId }), wake = resolveWakePolicy(services, target.value);
  if (!grants.ok) return grants; if (!applied.ok) return applied; if (!wake.ok) return wake;
  const joined = new Map(applied.value.filter(record => record.membership === 'join' && record.errorCode === null).map(record => [record.roomId, record]));
  return success({ record: target.value, grants: grants.value.filter(grant => grant.accessMode !== 'none'
    && joined.get(grant.roomId)?.observedGeneration === grant.generation), wake: wake.value });
}
