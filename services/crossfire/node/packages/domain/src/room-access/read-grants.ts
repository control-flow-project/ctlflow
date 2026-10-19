import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import type { PageRequest } from '../port/directory.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'roomGrantRead' | 'clock' | 'messaging' | 'runtime'>;
export function listRoomGrants(services: Dependencies, actor: Actor, agentId: string, page: PageRequest & { roomIds?: string[] }) {
  const target = authorizeAgent(services, actor, agentId, 'read');
  if (!target.ok) return target;
  const grants = services.roomGrantRead.page(agentId, page);
  if (!grants.ok) return grants;
  const roomIds = grants.value.items.map(grant => grant.roomId);
  const applications = services.roomGrantRead.applications(agentId, roomIds), permissions = services.roomGrantRead.permissions(agentId, roomIds);
  if (!applications.ok) return applications; if (!permissions.ok) return permissions;
  const canManage = authorizeAgent(services, actor, agentId, 'room-grant.manage').ok;
  const conversation = services.repositories.ownerConversation.find({ agentId });
  if (!conversation.ok) return conversation;
  return success({ ...grants.value, items: grants.value.items.map(grant => ({
    agentId, revision: target.value.principal.revision, ownerConversation: conversation.value?.roomId === grant.roomId,
    grant, application: applications.value.find(application => application.roomId === grant.roomId) ?? null,
    permissions: permissions.value.filter(permission => permission.roomId === grant.roomId).map(permission => permission.permissionCode),
    allowedActions: canManage && conversation.value?.roomId !== grant.roomId ? ['set', 'remove', 'permissions.set'] : [],
  })) });
}
export async function readRoomGrant(services: Dependencies, actor: Actor, agentId: string, roomId: string) {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  const target = services.directory.agent(agentId);
  if (!target.ok) return target;
  if (!target.value) return failure('missing', 'Agent not found');
  let canRead = authorizeAgent(services, actor, agentId, 'read').ok;
  let delegated = false;
  if (!canRead && actor.kind === 'agent') {
    const inviter = services.repositories.agentRoomGrant.find({ agentId: actor.principalId, roomId });
    const permission = services.repositories.agentRoomPermission.find({ agentId: actor.principalId, roomId, permissionCode: 'room.agent.invite' });
    if (!inviter.ok) return inviter; if (!permission.ok) return permission;
    if (inviter.value && inviter.value.accessMode !== 'none' && permission.value?.generation === inviter.value.generation) {
      const native = await services.messaging.room(current.value.backendUserId, roomId);
      if (!native.ok) return native;
      delegated = native.value.canInvite;
      canRead = delegated;
    }
  }
  if (!canRead) return failure('missing', 'Room grant not found');
  const grant = services.repositories.agentRoomGrant.find({ agentId, roomId }), application = services.repositories.roomGrantApplication.find({ agentId, roomId });
  const permissions = services.collection.roomPermissions({ agentId, roomId });
  const conversation = services.repositories.ownerConversation.find({ agentId });
  if (!grant.ok) return grant; if (!application.ok) return application; if (!permissions.ok) return permissions; if (!conversation.ok) return conversation;
  const canManage = authorizeAgent(services, actor, agentId, 'room-grant.manage').ok;
  const ownAddition = grant.value?.addedById === actor.principalId;
  const allowedActions = conversation.value?.roomId === roomId ? [] : canManage ? ['set', 'remove', 'permissions.set']
    : delegated ? !grant.value || grant.value.accessMode === 'none' ? ['set'] : ownAddition ? ['set', 'remove'] : [] : [];
  return success({ agentId, revision: target.value.principal.revision, ownerConversation: conversation.value?.roomId === roomId, grant: grant.value, application: application.value,
    permissions: permissions.value.map(permission => permission.permissionCode), allowedActions });
}
