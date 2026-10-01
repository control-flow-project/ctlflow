import { success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { AgentRecord, DirectoryRepository } from '../port/directory.js';
import type { AgentWakeSender } from '../room-access/types.js';

type ActiveIdentities = Extract<ReturnType<DirectoryRepository['activePrincipals']>, { ok: true }>['value'];
export function wakeSenderMatrixIds(agent: AgentRecord, identities: ActiveIdentities, selected: AgentWakeSender[]): string[] {
  const selectedIds = new Set(selected.map(sender => sender.senderPrincipalId));
  return identities.filter(({ principal, ownerId }) => {
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
}

export function resolveWakePolicy(services: Pick<Services, 'directory' | 'collection'>, agent: AgentRecord) {
  const identities = services.directory.activePrincipals();
  if (!identities.ok) return identities;
  const selected = services.collection.wakeSenders({ agentId: agent.principal.id });
  if (!selected.ok) return selected;
  return success({ mode: agent.agent.wakeMode, senders: wakeSenderMatrixIds(agent, identities.value, selected.value) });
}
