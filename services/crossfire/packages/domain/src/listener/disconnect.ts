import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
export function disconnectListeners(services: Pick<Services, 'repositories' | 'directory' | 'unitOfWork' | 'clock' | 'identity'>,
  actor: Actor, agentId: string, input: { expectedRevision: number; runIds: string[] }, requestId: string) {
  return services.unitOfWork.run(() => {
    const target = authorizeAgent(services, actor, agentId, 'listener.disconnect');
    if (!target.ok) return target;
    if (target.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
    if (!input.runIds.length || input.runIds.length > 100 || new Set(input.runIds).size !== input.runIds.length) return failure('invalid', 'Confirm a specific set of listener runs');
    for (const id of input.runIds) {
      const found = services.repositories.listenerRun.find({ id });
      if (!found.ok) return found;
      if (!found.value || found.value.agentId !== agentId) return failure('missing', 'Listener run not found');
      if (found.value.stoppedAt !== null || found.value.disconnectRequestedAt !== null) continue;
      const changed = services.repositories.listenerRun.update({ ...found.value, disconnectRequestedAt: services.clock.now() });
      if (!changed.ok) return changed;
      const audit = recordEvent(services, actor, requestId, { targetKind: 'listener-run', targetId: id, ownerId: target.value.owner.id, action: 'listener.disconnect' });
      if (!audit.ok) return audit;
    }
    return success({ requestedRunIds: input.runIds });
  });
}
