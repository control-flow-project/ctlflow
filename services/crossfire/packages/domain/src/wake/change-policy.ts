import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { Agent } from '../identity/types.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';

export function changeWakePolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock'>,
  actor: Actor, agentId: string, input: { expectedRevision: number; mode: Agent['wakeMode']; senderIds: string[] }, requestId: string) {
  return services.unitOfWork.run(() => {
    const current = authorizeAgent(services, actor, agentId, 'configure');
    if (!current.ok) return current;
    if (current.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
    if (current.value.principal.status === 'revoked') return failure('conflict', 'Account revocation is permanent');
    if (input.mode !== 'selected' && input.senderIds.length || new Set(input.senderIds).size !== input.senderIds.length || input.senderIds.length > 2000 || input.senderIds.includes(agentId)) return failure('invalid', 'Invalid selected sender list');
    for (const id of input.senderIds) {
      const sender = services.repositories.principal.find({ id });
      if (!sender.ok) return sender;
      if (!sender.value || sender.value.status !== 'active') return failure('invalid', 'Select active registered identities');
      if (sender.value.kind === 'agent') {
        const selectedAgent = services.directory.agent(id);
        if (!selectedAgent.ok) return selectedAgent;
        if (!selectedAgent.value || selectedAgent.value.owner.status !== 'active') return failure('invalid', 'Selected agent owner is not active');
      }
    }
    const previous = services.collection.wakeSenders({ agentId });
    if (!previous.ok) return previous;
    for (const sender of previous.value) {
      const removed = services.repositories.agentWakeSender.remove(sender);
      if (!removed.ok) return removed;
    }
    for (const senderPrincipalId of input.senderIds) {
      const added = services.repositories.agentWakeSender.insert({ agentId, senderPrincipalId });
      if (!added.ok) return added;
    }
    const changed = services.repositories.agent.update({ ...current.value.agent, wakeMode: input.mode });
    if (!changed.ok) return changed;
    const principal = services.repositories.principal.update({ ...current.value.principal, revision: input.expectedRevision + 1 });
    if (!principal.ok) return principal;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId, ownerId: current.value.owner.id, action: 'agent.wake-policy.configure' });
    return audit.ok ? success({ mode: input.mode, senderIds: [...input.senderIds].sort(), revision: input.expectedRevision + 1 }) : audit;
  });
}
