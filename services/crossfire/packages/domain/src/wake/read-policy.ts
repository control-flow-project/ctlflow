import { success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
export function readWakePolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>, actor: Actor, agentId: string) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const senders = services.collection.wakeSenders({ agentId });
  return senders.ok ? success({ agentId, revision: target.value.principal.revision, mode: target.value.agent.wakeMode,
    senderIds: senders.value.map(sender => sender.senderPrincipalId) }) : senders;
}
