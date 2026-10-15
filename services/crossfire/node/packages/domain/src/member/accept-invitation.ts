import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import { registerPrincipal } from '../principal/register.js';
import { recordEvent } from '../audit/record-event.js';
import type { MatrixAccount } from '../port/matrix-authority.js';
export async function acceptMemberInvitation(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'unitOfWork' | 'identity' | 'clock' | 'instance'>,
  invitationId: string, input: { claimSecret: string; username: string; password: string; displayName: string }, requestId: string, deviceId = 'CROSSFIRE_HUMAN'): Promise<Result<{ memberId: string; account: MatrixAccount }>> {
  if (!/^[a-z0-9][a-z0-9._=\-]{0,99}$/u.test(input.username) || input.password.length < 12 || input.password.length > 1024
    || !input.displayName || input.displayName.length > 100 || /[\u0000-\u001f\u007f]/u.test(input.displayName)) return failure('invalid', 'Invalid human account details');
  const matrixUserId = '@' + input.username + ':' + services.instance.serverName;
  if (matrixUserId === services.instance.serviceMatrixId || matrixUserId === '@conduit:' + services.instance.serverName) return failure('forbidden', 'Reserved native identity');
  const fingerprint = services.identity.hash(JSON.stringify([input.claimSecret, matrixUserId, input.password, input.displayName]));
  const initial = services.repositories.memberInvitation.find({ id: invitationId });
  if (!initial.ok) return initial;
  if (!initial.value || initial.value.revokedAt !== null || initial.value.expiresAt <= services.clock.now()
    || !services.identity.matches(input.claimSecret, initial.value.claimHash)) return failure('unauthorized', 'Invalid or expired invitation');
  if (initial.value.consumedByMemberId !== null) {
    if (initial.value.claimFingerprint !== fingerprint) return failure('conflict', 'Invitation was consumed with different account details');
    const account = await services.matrix.provision(matrixUserId, input.password, deviceId);
    return account.ok ? success({ memberId: initial.value.consumedByMemberId, account: account.value }) : account;
  }
  if (initial.value.claimMatrixUserId === null) {
    const exists = await services.matrix.exists(matrixUserId);
    if (!exists.ok) return exists;
    if (exists.value) return failure('conflict', 'Native username is already registered');
  }
  const reserved = services.unitOfWork.run(() => {
    const current = services.repositories.memberInvitation.find({ id: invitationId });
    if (!current.ok) return current;
    if (!current.value || current.value.revokedAt !== null || current.value.expiresAt <= services.clock.now() || current.value.consumedByMemberId !== null
      || !services.identity.matches(input.claimSecret, current.value.claimHash)) return failure('unauthorized', 'Invitation is no longer usable');
    if (current.value.claimMatrixUserId !== null) return current.value.claimFingerprint === fingerprint ? success(undefined) : failure('conflict', 'Invitation is reserved for different account details');
    const existing = services.directory.principalByMatrixId(matrixUserId), claimed = services.collection.invitationByClaim(matrixUserId);
    if (!existing.ok) return existing; if (!claimed.ok) return claimed;
    if (existing.value || claimed.value) return failure('conflict', 'Identity is already reserved or registered');
    return services.repositories.memberInvitation.update({ ...current.value, claimMatrixUserId: matrixUserId, claimDisplayName: input.displayName, claimFingerprint: fingerprint });
  });
  if (!reserved.ok) return reserved;
  const provisioned = await services.matrix.provision(matrixUserId, input.password, deviceId);
  if (!provisioned.ok) return provisioned;
  return services.unitOfWork.run(() => {
    const current = services.repositories.memberInvitation.find({ id: invitationId });
    if (!current.ok) return current;
    if (!current.value || current.value.revokedAt !== null || current.value.expiresAt <= services.clock.now() || current.value.claimFingerprint !== fingerprint) return failure('conflict', 'Invitation changed during native provisioning; cleanup is pending');
    if (current.value.consumedByMemberId !== null) return success({ memberId: current.value.consumedByMemberId, account: provisioned.value });
    const memberId = services.identity.id();
    const registered = registerPrincipal(services, { id: memberId, matrixUserId, kind: 'human', status: 'active', revision: 0, createdAt: services.clock.now() }, current.value.roleCode, current.value.createdByMemberId);
    if (!registered.ok) return registered;
    const member = services.repositories.member.insert({ principalId: memberId, principalKind: 'human', displayName: input.displayName });
    if (!member.ok) return member;
    const consumed = services.repositories.memberInvitation.update({ ...current.value, consumedByMemberId: memberId });
    if (!consumed.ok) return consumed;
    const audit = recordEvent(services, null, requestId, { targetKind: 'member', targetId: memberId, ownerId: memberId, action: 'member-invitation.accept' });
    return audit.ok ? success({ memberId, account: provisioned.value }) : audit;
  });
}
