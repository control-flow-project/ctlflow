import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
export function invitationAuthority(services: Pick<Services, 'repositories' | 'directory' | 'clock'>, actor: Actor) {
  const permission = authorize(services, actor, 'member.invite');
  if (!permission.ok) return permission;
  const permissions = services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  const administrator = permissions.value.includes('member.manage');
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!policy.ok) return policy;
  return administrator || policy.value?.invitationIssuers === 'members'
    ? success({ administrator }) : failure('forbidden', 'Only administrators may invite members');
}
