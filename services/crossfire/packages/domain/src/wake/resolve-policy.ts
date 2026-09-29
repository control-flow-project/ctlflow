import { success } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import type { AgentRecord } from '../port/directory.js';

export function resolveWakePolicy(services: Pick<Services, 'directory' | 'collection'>, agent: AgentRecord) {
  const identities = services.directory.activePrincipals();
  if (!identities.ok) return identities;
  const selected = services.collection.wakeSenders({ agentId: agent.principal.id });
  if (!selected.ok) return selected;
  const selectedIds = new Set(selected.value.map(sender => sender.senderPrincipalId));
  const senders = identities.value.filter(({ principal, ownerId }) => {
    if (principal.id === agent.principal.id) return false;
    switch (agent.agent.wakeMode) {
      case 'nobody': return false;
      case 'selected': return selectedIds.has(principal.id);
      case 'owner': return principal.id === agent.owner.id;
      case 'owner-agents': return ownerId === agent.owner.id;
      case 'humans': return principal.kind === 'human' || ownerId === agent.owner.id;
      case 'everyone': return true;
    }
  }).map(value => value.principal.matrixUserId).sort();
  return success({ mode: agent.agent.wakeMode, senders });
}
