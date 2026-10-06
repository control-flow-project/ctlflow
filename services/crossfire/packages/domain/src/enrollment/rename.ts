import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { EnrollmentItem } from './types.js';
import { recordEvent } from '../audit/record-event.js';

export function applyEnrolledName(services: Pick<Services, 'repositories' | 'directory' | 'identity' | 'clock'>,
  actor: Actor, item: EnrollmentItem, requestId: string) {
  if (!item.agentId) return failure('conflict', 'A registered name requires its approved agent identity');
  const current = services.directory.agent(item.agentId);
  if (!current.ok) return current;
  if (!current.value || actor.kind !== 'human' || current.value.agent.ownerId !== actor.principalId
    || current.value.owner.status !== 'active') return failure('forbidden', 'Only the active human owner may approve an agent name');
  if (current.value.name === item.requestedName) return success(undefined);
  const reserved = services.repositories.agentName.find({ name: item.requestedName });
  if (!reserved.ok) return reserved;
  if (!reserved.value || reserved.value.agentId !== null || reserved.value.requestId !== item.requestId
    || reserved.value.instanceKey !== item.instanceKey) return failure('conflict', 'The reviewed name reservation changed');
  const removed = services.repositories.agentName.remove({ name: current.value.name });
  if (!removed.ok) return removed;
  const claimed = services.repositories.agentName.update({ name: item.requestedName, agentId: item.agentId, requestId: null, instanceKey: null });
  if (!claimed.ok) return claimed;
  const changed = services.repositories.principal.update({ ...current.value.principal, revision: current.value.principal.revision + 1 });
  if (!changed.ok) return changed;
  const scheduled = services.repositories.principalApplication.update({ ...current.value.application, nextCheckAt: services.clock.now() });
  if (!scheduled.ok) return scheduled;
  return recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: item.agentId, ownerId: current.value.agent.ownerId,
    action: 'agent.rename', message: current.value.name + ' → ' + item.requestedName });
}
