import { success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { resolveWakePolicy } from '../wake/resolve-policy.js';
export function deliveryPolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>, actor: Actor, agentId: string) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const grants = services.collection.roomGrants({ agentId }), wake = resolveWakePolicy(services, target.value);
  if (!grants.ok) return grants; if (!wake.ok) return wake;
  return success({ record: target.value, grants: grants.value.filter(grant => grant.accessMode !== 'none'), wake: wake.value });
}
