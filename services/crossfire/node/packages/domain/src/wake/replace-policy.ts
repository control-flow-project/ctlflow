import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { Agent } from '../identity/types.js';
import type { WakeSelection } from './types.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection'>;
export function validateWakeSenders(services: Dependencies, agentId: string | null, mode: Agent['wakeMode'], senders: WakeSelection[]) {
  if (!['humans', 'everyone', 'selected'].includes(mode)
    || mode === 'everyone' && senders.length !== 0 || new Set(senders.map(sender => sender.principalId)).size !== senders.length
    || senders.length > 2000 || senders.some(sender => typeof sender.includeAgents !== 'boolean' || sender.principalId === agentId))
    return failure('invalid', 'Invalid selected sender list');
  for (const selection of senders) {
    const sender = services.repositories.principal.find({ id: selection.principalId });
    if (!sender.ok) return sender;
    if (!sender.value || sender.value.status !== 'active') return failure('invalid', 'Select active registered identities');
    if (sender.value.kind === 'agent') {
      if (selection.includeAgents) return failure('invalid', 'Only people can include their agents');
      const selected = services.directory.agent(selection.principalId);
      if (!selected.ok) return selected;
      if (!selected.value || selected.value.owner.status !== 'active') return failure('invalid', 'Selected agent owner is not active');
    }
  }
  return success(undefined);
}

export function replaceWakePolicy(services: Dependencies, agent: Agent, mode: Agent['wakeMode'], senders: WakeSelection[]) {
  const valid = validateWakeSenders(services, agent.principalId, mode, senders);
  if (!valid.ok) return valid;
  const previous = services.collection.wakeSenders({ agentId: agent.principalId });
  if (!previous.ok) return previous;
  for (const sender of previous.value) {
    const removed = services.repositories.agentWakeSender.remove(sender);
    if (!removed.ok) return removed;
  }
  for (const sender of senders) {
    const added = services.repositories.agentWakeSender.insert({ agentId: agent.principalId, senderPrincipalId: sender.principalId, includeAgents: sender.includeAgents });
    if (!added.ok) return added;
  }
  return services.repositories.agent.update({ ...agent, wakeMode: mode });
}
