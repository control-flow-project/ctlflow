import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { Principal } from '../identity/types.js';
import { authorize } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';

export function changeMember(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock'>,
  actor: Actor, memberId: string, input: { expectedRevision: number; status?: Principal['status']; displayName?: string; roleCode?: 'member' | 'administrator' }, requestId: string) {
  if (input.displayName !== undefined && (!input.displayName || input.displayName.length > 100 || /[\u0000-\u001f\u007f]/u.test(input.displayName))) return failure('invalid', 'Member names must contain 1–100 characters without control characters');
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'member.manage');
    if (!authority.ok) return authority;
    const found = services.directory.member(memberId);
    if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Member not found');
    const current = found.value;
    if (current.principal.status === 'revoked') return failure('conflict', 'Account revocation is permanent');
    if (current.principal.revision !== input.expectedRevision) return failure('conflict', 'Member revision changed');
    const status = input.status ?? current.principal.status, roleCode = input.roleCode ?? current.role.roleCode;
    if (current.role.roleCode === 'administrator' && current.principal.status === 'active' && (roleCode !== 'administrator' || status !== 'active')) {
      const count = services.directory.activeAdministratorCount();
      if (!count.ok) return count;
      if (count.value <= 1) return failure('forbidden', 'At least one active administrator is required');
    }
    const principal = services.repositories.principal.update({ ...current.principal, status, revision: input.expectedRevision + 1 });
    if (!principal.ok) return principal;
    const role = services.repositories.principalRole.update({ ...current.role, roleCode, assignedByMemberId: actor.principalId, assignedAt: services.clock.now() });
    if (!role.ok) return role;
    const member = services.repositories.member.update({ ...current.member, displayName: input.displayName ?? current.member.displayName });
    if (!member.ok) return member;
    const scheduled = services.repositories.principalApplication.update({ ...current.application, nextCheckAt: services.clock.now() });
    if (!scheduled.ok) return scheduled;
    const agents = services.directory.agentIds(memberId);
    if (!agents.ok) return agents;
    for (const id of agents.value) {
      const agent = services.directory.agent(id);
      if (!agent.ok) return agent;
      if (!agent.value) return failure('missing', 'Owned agent state is missing');
      if (status === 'revoked' && agent.value.principal.status !== 'revoked') {
        const revoked = services.repositories.principal.update({ ...agent.value.principal, status: 'revoked', revision: agent.value.principal.revision + 1 });
        if (!revoked.ok) return revoked;
      }
      const pending = services.repositories.principalApplication.update({ ...agent.value.application, nextCheckAt: services.clock.now() });
      if (!pending.ok) return pending;
      const grants = services.collection.agentRoomApplications({ agentId: id });
      if (!grants.ok) return grants;
      for (const grant of grants.value) {
        const due = services.repositories.roomGrantApplication.update({ ...grant, nextCheckAt: services.clock.now() });
        if (!due.ok) return due;
      }
    }
    const audit = recordEvent(services, actor, requestId, { targetKind: 'member', targetId: memberId, ownerId: memberId, action: 'member.configure' });
    return audit.ok ? success({ principal: { ...current.principal, status, revision: input.expectedRevision + 1 },
      member: { ...current.member, displayName: input.displayName ?? current.member.displayName },
      role: { ...current.role, roleCode, assignedByMemberId: actor.principalId, assignedAt: services.clock.now() },
      application: { ...current.application, nextCheckAt: services.clock.now() } }) : audit;
  });
}
