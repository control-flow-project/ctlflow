import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { Agent } from '../identity/types.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
import { replaceWakePolicy } from './replace-policy.js';
import type { WakeSelection } from './types.js';

export function changeWakePolicy(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock'>,
  actor: Actor, agentId: string, input: { expectedRevision: number; mode: Agent['wakeMode']; senders: WakeSelection[] }, requestId: string) {
  return services.unitOfWork.run(() => {
    const current = authorizeAgent(services, actor, agentId, 'configure');
    if (!current.ok) return current;
    if (current.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
    if (current.value.principal.status === 'revoked') return failure('conflict', 'Account revocation is permanent');
    const changed = replaceWakePolicy(services, current.value.agent, input.mode, input.senders);
    if (!changed.ok) return changed;
    const principal = services.repositories.principal.update({ ...current.value.principal, revision: input.expectedRevision + 1 });
    if (!principal.ok) return principal;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId, ownerId: current.value.owner.id, action: 'agent.wake-policy.configure' });
    return audit.ok ? success({ mode: input.mode, senders: [...input.senders].sort((left, right) => left.principalId.localeCompare(right.principalId)), revision: input.expectedRevision + 1 }) : audit;
  });
}
