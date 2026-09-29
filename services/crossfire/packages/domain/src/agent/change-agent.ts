import { failure, success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import type { Principal } from '../identity/types.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';

export function changeAgent(services: Pick<Services, 'repositories' | 'directory' | 'unitOfWork' | 'identity' | 'clock'>,
  actor: Actor, agentId: string, input: { expectedRevision: number; status?: Principal['status']; displayName?: string | null }, requestId: string) {
  return services.unitOfWork.run(() => {
    const current = authorizeAgent(services, actor, agentId, 'configure');
    if (!current.ok) return current;
    if (current.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
    if (current.value.principal.status === 'revoked') return failure('conflict', 'Account revocation is permanent');
    const agent = { ...current.value.agent, displayNameOverride: input.displayName === undefined ? current.value.agent.displayNameOverride : input.displayName };
    const principal = { ...current.value.principal, status: input.status ?? current.value.principal.status, revision: input.expectedRevision + 1 };
    const changed = services.repositories.principal.update(principal);
    if (!changed.ok) return changed;
    const saved = services.repositories.agent.update(agent);
    if (!saved.ok) return saved;
    const scheduled = services.repositories.principalApplication.update({ ...current.value.application, nextCheckAt: services.clock.now() });
    if (!scheduled.ok) return scheduled;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId, ownerId: agent.ownerId, action: 'agent.configure' });
    return audit.ok ? success({ principal, agent }) : audit;
  });
}
