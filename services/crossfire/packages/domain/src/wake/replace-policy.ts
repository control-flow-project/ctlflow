import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { Agent } from '../identity/types.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection'>;
export function validateWakeSenders(services: Dependencies, agentId: string | null, mode: Agent['wakeMode'], senderIds: string[]) {
  if (!['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected'].includes(mode)
    || mode !== 'selected' && senderIds.length !== 0 || new Set(senderIds).size !== senderIds.length
    || senderIds.length > 2000 || agentId !== null && senderIds.includes(agentId)) return failure('invalid', 'Invalid selected sender list');
  for (const id of senderIds) {
    const sender = services.repositories.principal.find({ id });
    if (!sender.ok) return sender;
    if (!sender.value || sender.value.status !== 'active') return failure('invalid', 'Select active registered identities');
    if (sender.value.kind === 'agent') {
      const selected = services.directory.agent(id);
      if (!selected.ok) return selected;
      if (!selected.value || selected.value.owner.status !== 'active') return failure('invalid', 'Selected agent owner is not active');
    }
  }
  return success(undefined);
}

export function replaceWakePolicy(services: Dependencies, agent: Agent, mode: Agent['wakeMode'], senderIds: string[]) {
  const valid = validateWakeSenders(services, agent.principalId, mode, senderIds);
  if (!valid.ok) return valid;
  const previous = services.collection.wakeSenders({ agentId: agent.principalId });
  if (!previous.ok) return previous;
  for (const sender of previous.value) {
    const removed = services.repositories.agentWakeSender.remove(sender);
    if (!removed.ok) return removed;
  }
  for (const senderPrincipalId of senderIds) {
    const added = services.repositories.agentWakeSender.insert({ agentId: agent.principalId, senderPrincipalId });
    if (!added.ok) return added;
  }
  return services.repositories.agent.update({ ...agent, wakeMode: mode });
}
