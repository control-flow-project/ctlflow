import { success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { AgentRecord, DirectoryRepository } from '../port/directory.js';
import type { AgentWakeSender } from '../room-access/types.js';

type ActiveIdentities = Extract<ReturnType<DirectoryRepository['activePrincipals']>, { ok: true }>['value'];
export function wakeSenderBackendUserIds(agent: AgentRecord, identities: ActiveIdentities, selected: AgentWakeSender[]): string[] {
  const selectedIds = new Set(selected.map(sender => sender.senderPrincipalId));
  const selectedOwners = new Set(selected.filter(sender => sender.includeAgents).map(sender => sender.senderPrincipalId));
  return identities.filter(({ principal, ownerId }) => {
    if (principal.id === agent.principal.id) return false;
    return agent.agent.wakeMode === 'everyone' || agent.agent.wakeMode === 'humans' && principal.kind === 'human'
      || selectedIds.has(principal.id) || principal.kind === 'agent' && selectedOwners.has(ownerId);
  }).map(value => value.principal.backendUserId).sort();
}

export function resolveWakePolicy(services: Pick<Services, 'directory' | 'collection'>, agent: AgentRecord) {
  const identities = services.directory.activePrincipals();
  if (!identities.ok) return identities;
  const selected = services.collection.wakeSenders({ agentId: agent.principal.id });
  if (!selected.ok) return selected;
  return success({ mode: agent.agent.wakeMode, senders: wakeSenderBackendUserIds(agent, identities.value, selected.value) });
}
