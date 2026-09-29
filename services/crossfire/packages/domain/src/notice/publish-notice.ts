import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import { resolveWakePolicy } from '../wake/resolve-policy.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'clock' | 'identity' | 'matrix'>;
export async function publishWakeNotice(services: Dependencies, receiverAgentId: string, eventId: string): Promise<Result<void>> {
  const found = services.repositories.wakeNotice.find({ receiverAgentId, eventId });
  if (!found.ok) return found;
  if (!found.value || found.value.status !== 'pending') return success(undefined);
  const notice = found.value;
  const agent = services.directory.agent(receiverAgentId);
  const grant = services.repositories.agentRoomGrant.find({ agentId: receiverAgentId, roomId: notice.roomId });
  if (!agent.ok) return agent; if (!grant.ok) return grant;
  let result: Result<string>;
  if (!agent.value || agent.value.principal.status !== 'active' || agent.value.owner.status !== 'active'
    || !grant.value || grant.value.accessMode === 'none' || grant.value.accessMode === 'read' || grant.value.muted) {
    result = failure('forbidden', 'The receiver no longer permits a room notice');
  } else {
    const wake = resolveWakePolicy(services, agent.value);
    if (!wake.ok) return wake;
    if (wake.value.senders.includes(notice.senderMatrixId) && notice.lastError === null) result = failure('forbidden', 'The sender now has wake authority');
    else {
      const transactionId = services.identity.hash('wake-notice:' + receiverAgentId + ':' + eventId);
      result = await services.matrix.sendNotice(agent.value.principal.matrixUserId, notice.roomId, transactionId, notice.messageBody, notice.senderMatrixId);
    }
  }
  return services.unitOfWork.run(() => {
    const current = services.repositories.wakeNotice.find({ receiverAgentId, eventId });
    if (!current.ok) return current;
    if (!current.value || current.value.status !== 'pending') return success(undefined);
    const denied = !result.ok && result.error.code === 'forbidden' && notice.lastError === null;
    return services.repositories.wakeNotice.update({ ...current.value,
      status: result.ok ? 'sent' : denied ? 'denied' : 'pending', sentAt: result.ok ? services.clock.now() : null,
      nativeEventId: result.ok ? result.value : null, nextAttemptAt: result.ok || denied ? null : services.clock.now() + 30_000,
      lastError: result.ok ? null : result.error.message });
  });
}
