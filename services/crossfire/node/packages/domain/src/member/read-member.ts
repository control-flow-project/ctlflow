import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { authorize } from '../authorization/authorize.js';
import { invitationAuthority } from './invitation-authority.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>;
export function readMember(services: Dependencies, actor: Actor, memberId: string) {
  const permission = authorize(services, actor, 'member.manage');
  if (!permission.ok) return permission;
  const member = services.directory.member(memberId);
  return member.ok ? member.value ? success(member.value) : failure('missing', 'Member not found') : member;
}
export function listMembers(services: Dependencies, actor: Actor, page: PageRequest) {
  const permission = authorize(services, actor, 'member.manage');
  return permission.ok ? services.directory.members(page) : permission;
}
export function readInvitation(services: Dependencies, actor: Actor, invitationId: string) {
  const permission = invitationAuthority(services, actor);
  if (!permission.ok) return permission;
  const invitation = services.repositories.memberInvitation.find({ id: invitationId });
  return invitation.ok ? invitation.value && (permission.value.administrator || invitation.value.createdByMemberId === actor.principalId)
    ? success(invitation.value) : failure('missing', 'Invitation not found') : invitation;
}
export function listInvitations(services: Dependencies, actor: Actor, page: PageRequest) {
  const permission = invitationAuthority(services, actor);
  return permission.ok ? services.collection.invitations({ ...page, ...(!permission.value.administrator ? { createdByMemberId: actor.principalId } : {}) }) : permission;
}
