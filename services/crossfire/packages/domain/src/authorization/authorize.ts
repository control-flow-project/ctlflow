import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { PermissionCode } from './catalog.js';
import type { Actor, Services } from '../port/services.js';
import type { Principal } from '../identity/types.js';

export function activeActor(services: Pick<Services, 'repositories' | 'clock'>, actor: Actor): Result<Principal> {
  const principal = services.repositories.principal.find({ id: actor.principalId });
  if (!principal.ok) return principal;
  if (!principal.value || principal.value.kind !== actor.kind || principal.value.status !== 'active') return failure('forbidden', 'An active registered identity is required');
  if (actor.kind === 'human') {
    if (!actor.sessionHash) return failure('unauthorized', 'A human management session is required');
    const session = services.repositories.memberSession.find({ secretHash: actor.sessionHash });
    if (!session.ok) return session;
    if (!session.value || session.value.memberId !== actor.principalId || session.value.expiresAt <= services.clock.now()) return failure('unauthorized', 'Management session expired or ended');
  } else {
    const agent = services.repositories.agent.find({ principalId: actor.principalId });
    if (!agent.ok) return agent;
    if (!agent.value) return failure('forbidden', 'Agent identity is not registered');
    const owner = services.repositories.principal.find({ id: agent.value.ownerId });
    if (!owner.ok) return owner;
    if (!owner.value || owner.value.status !== 'active') return failure('forbidden', 'Agent owner must be active');
  }
  return success(principal.value);
}

export function authorize(services: Pick<Services, 'repositories' | 'directory' | 'clock'>, actor: Actor, permission: PermissionCode): Result<Principal> {
  const principal = activeActor(services, actor);
  if (!principal.ok) return principal;
  const permissions = services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  return permissions.value.includes(permission) ? principal : failure('forbidden', 'Permission required: ' + permission);
}

export function authorizeAgent(services: Pick<Services, 'repositories' | 'directory' | 'clock'>, actor: Actor, agentId: string,
  action: 'read' | 'configure' | 'room-grant.manage' | 'listener.disconnect') {
  const principal = activeActor(services, actor);
  if (!principal.ok) return principal;
  const agent = services.directory.agent(agentId);
  if (!agent.ok) return agent;
  if (!agent.value) return failure('missing', 'Agent not found');
  const permissions = services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  const allowed = permissions.value.includes('agent.' + action + '.any')
    || agent.value.agent.ownerId === actor.principalId && permissions.value.includes('agent.' + action + '.owned')
    || action === 'read' && agentId === actor.principalId && permissions.value.includes('agent.read.self');
  return allowed ? success(agent.value) : failure('missing', 'Agent not found');
}
