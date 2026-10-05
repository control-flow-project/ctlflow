import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { invitationAuthority } from './invitation-authority.js';
import { recordEvent } from '../audit/record-event.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'unitOfWork' | 'identity' | 'clock'>;
export function createMemberInvitation(services: Dependencies, actor: Actor, input: { roleCode: 'member' | 'administrator'; expiresSeconds: number }, requestId: string) {
  if (!Number.isSafeInteger(input.expiresSeconds) || input.expiresSeconds < 60 || input.expiresSeconds > 604800) return failure('invalid', 'Invitation lifetime must be 60–604800 seconds');
  return services.unitOfWork.run(() => {
    const authority = invitationAuthority(services, actor);
    if (!authority.ok) return authority;
    if (!authority.value.administrator && input.roleCode !== 'member') return failure('forbidden', 'Only administrators may invite administrators');
    const id = services.identity.id(), claimSecret = services.identity.secret(), now = services.clock.now();
    const saved = services.repositories.memberInvitation.insert({ id, createdByMemberId: actor.principalId, claimHash: services.identity.hash(claimSecret),
      roleCode: input.roleCode, principalKind: 'human', createdAt: now, expiresAt: now + input.expiresSeconds * 1000,
      consumedByMemberId: null, revokedAt: null, claimMatrixUserId: null, claimDisplayName: null, claimFingerprint: null });
    if (!saved.ok) return saved;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'member-invitation', targetId: id, action: 'member-invitation.create' });
    return audit.ok ? success({ invitationId: id, claimSecret, expiresAt: now + input.expiresSeconds * 1000 }) : audit;
  });
}
export function revokeMemberInvitation(services: Dependencies, actor: Actor, invitationId: string, requestId: string) {
  return services.unitOfWork.run(() => {
    const authority = invitationAuthority(services, actor);
    if (!authority.ok) return authority;
    const found = services.repositories.memberInvitation.find({ id: invitationId });
    if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Invitation not found');
    if (!authority.value.administrator && found.value.createdByMemberId !== actor.principalId) return failure('missing', 'Invitation not found');
    if (found.value.consumedByMemberId !== null) return failure('conflict', 'Invitation is already consumed');
    const saved = services.repositories.memberInvitation.update({ ...found.value, revokedAt: found.value.revokedAt ?? services.clock.now() });
    if (!saved.ok) return saved;
    return recordEvent(services, actor, requestId, { targetKind: 'member-invitation', targetId: invitationId, action: 'member-invitation.revoke' });
  });
}
