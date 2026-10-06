import { success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
export function readWakePolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock'>, actor: Actor, agentId: string) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const senders = services.collection.wakeSenders({ agentId });
  if (!senders.ok) return senders;
  const identities = services.discovery.selected(senders.value.map(sender => sender.senderPrincipalId));
  const selection = new Map(senders.value.map(sender => [sender.senderPrincipalId, sender.includeAgents]));
  return identities.ok ? success({ agentId, revision: target.value.principal.revision, mode: target.value.agent.wakeMode,
    senders: identities.value.map(identity => ({ identity, includeAgents: selection.get(identity.principalId)! })) }) : identities;
}
