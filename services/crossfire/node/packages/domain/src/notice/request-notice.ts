import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import { resolveWakePolicy } from '../wake/resolve-policy.js';
export const NOTICE_COOLDOWN_MS = 600_000;
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'clock' | 'messaging'>;
export async function requestWakeNotice(services: Dependencies, actor: Actor, receiverAgentId: string, roomId: string, eventId: string) {
  const authority = authorize(services, actor, 'wake-notice.publish.self');
  if (!authority.ok) return authority;
  if (actor.principalId !== receiverAgentId) return failure('missing', 'Receiving agent not found');
  const receiver = services.directory.agent(receiverAgentId);
  if (!receiver.ok) return receiver;
  if (!receiver.value) return failure('missing', 'Receiving agent not found');
  const event = await services.messaging.event(receiver.value.principal.backendUserId, roomId, eventId);
  if (!event.ok) return event;
  return services.unitOfWork.run(() => {
    const rechecked = authorize(services, actor, 'wake-notice.publish.self');
    if (!rechecked.ok) return rechecked;
    const current = services.directory.agent(receiverAgentId);
    if (!current.ok) return current;
    if (!current.value) return failure('missing', 'Receiving agent not found');
    const prior = services.repositories.wakeNotice.find({ receiverAgentId, roomId, eventId });
    if (!prior.ok) return prior;
    if (prior.value) return success({ outcome: prior.value.status });
    const message = event.value;
    if (message.eventId !== eventId || message.roomId !== roomId || message.type !== 'message' || message.messageType !== 'text'
      || message.edited || message.control || message.senderBackendUserId === current.value.principal.backendUserId
      || !message.mentions.includes(current.value.principal.backendUserId)) return success({ outcome: 'not-applicable' });
    const grant = services.repositories.agentRoomGrant.find({ agentId: receiverAgentId, roomId });
    if (!grant.ok) return grant;
    if (!grant.value || grant.value.accessMode === 'none' || grant.value.muted || grant.value.accessMode === 'read') return success({ outcome: 'not-permitted' });
    const wake = resolveWakePolicy(services, current.value);
    if (!wake.ok) return wake;
    if (wake.value.senders.includes(message.senderBackendUserId)) return success({ outcome: 'not-applicable' });
    const recent = services.collection.noticeHistory({ receiverAgentId, senderBackendUserId: message.senderBackendUserId, since: services.clock.now() - NOTICE_COOLDOWN_MS });
    if (!recent.ok) return recent;
    if (recent.value.length) return success({ outcome: 'rate-limited' });
    const receiverName = current.value.name;
    const body = message.senderBackendUserId + ', ' + receiverName + ' won’t wake under its current rules. '
      + current.value.ownerMember.displayName + ' (' + current.value.owner.backendUserId + ') can change them.';
    const saved = services.repositories.wakeNotice.insert({ receiverAgentId, eventId, senderBackendUserId: message.senderBackendUserId, roomId,
      reservedAt: services.clock.now(), messageBody: body, status: 'pending', sentAt: null, nativeEventId: null,
      nextAttemptAt: services.clock.now(), lastError: null });
    return saved.ok ? success({ outcome: 'pending' }) : saved;
  });
}
