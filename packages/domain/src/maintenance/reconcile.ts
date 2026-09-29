import { success, type Result } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import { expireEnrollments } from '../enrollment/expire.js';
import { reconcilePrincipal } from '../principal/reconcile.js';
import { reconcileRoomGrant } from '../room-access/reconcile-grant.js';
import { publishWakeNotice } from '../notice/publish-notice.js';
export async function reconcile(services: Services, stopped: () => boolean): Promise<Result<void>> {
  const expired = services.unitOfWork.run(() => {
    const requests = expireEnrollments(services);
    return requests.ok ? services.collection.removeExpiredSessions(services.clock.now()) : requests;
  });
  if (!expired.ok) return expired;
  const claims = services.collection.claimedInvitations({ now: services.clock.now() });
  if (!claims.ok) return claims;
  for (const invitation of claims.value) {
    if (stopped()) return success(undefined);
    const removed = await services.matrix.discard(invitation.claimMatrixUserId!);
    if (!removed.ok) continue;
    const cleared = services.unitOfWork.run(() => {
      const current = services.repositories.memberInvitation.find({ id: invitation.id });
      if (!current.ok) return current;
      if (!current.value || current.value.consumedByMemberId !== null || current.value.claimFingerprint !== invitation.claimFingerprint) return success(undefined);
      return services.repositories.memberInvitation.update({ ...current.value, claimMatrixUserId: null, claimDisplayName: null, claimFingerprint: null });
    });
    if (!cleared.ok) return cleared;
  }
  const principals = services.collection.duePrincipals({ now: services.clock.now() });
  if (!principals.ok) return principals;
  for (const principal of principals.value) {
    if (stopped()) return success(undefined);
    const applied = await reconcilePrincipal(services, principal.principalId);
    if (!applied.ok && applied.error.code !== 'conflict') return applied;
  }
  const grants = services.collection.dueRoomGrants({ now: services.clock.now() });
  if (!grants.ok) return grants;
  for (const grant of grants.value) {
    if (stopped()) return success(undefined);
    const applied = await reconcileRoomGrant(services, grant.agentId, grant.roomId);
    if (!applied.ok && applied.error.code !== 'conflict') return applied;
  }
  const notices = services.collection.pendingNotices({ now: services.clock.now() });
  if (!notices.ok) return notices;
  for (const notice of notices.value) {
    if (stopped()) return success(undefined);
    const sent = await publishWakeNotice(services, notice.receiverAgentId, notice.eventId);
    if (!sent.ok && sent.error.code !== 'conflict') return sent;
  }
  return success(undefined);
}
