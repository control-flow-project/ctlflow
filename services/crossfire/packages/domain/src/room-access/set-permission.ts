import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
export function setRoomPermission(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'unitOfWork'>,
  actor: Actor, input: { agentId: string; roomId: string; expectedRevision: number; expectedGeneration: string; permissions: string[] }, requestId: string) {
  return services.unitOfWork.run(() => {
    if (actor.kind !== 'human') return failure('forbidden', 'Agents cannot delegate invitation permission onward');
    const target = authorizeAgent(services, actor, input.agentId, 'room-grant.manage');
    if (!target.ok) return target;
    const conversation = services.repositories.ownerConversation.find({ agentId: input.agentId });
    if (!conversation.ok) return conversation;
    if (conversation.value?.roomId === input.roomId) return failure('forbidden', 'Owner DMs are private channels and cannot delegate invitations');
    if (target.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
    if (target.value.principal.status !== 'active' || target.value.owner.status !== 'active') return failure('forbidden', 'Agent and owner must be active');
    if (input.permissions.length > 1 || input.permissions.some(code => code !== 'room.agent.invite')) return failure('invalid', 'Unsupported room-scoped permission');
    const grant = services.repositories.agentRoomGrant.find({ agentId: input.agentId, roomId: input.roomId });
    if (!grant.ok) return grant;
    if (!grant.value || grant.value.accessMode === 'none' || grant.value.generation !== input.expectedGeneration) return failure('conflict', 'An active matching room grant is required');
    const previous = services.collection.roomPermissions(input);
    if (!previous.ok) return previous;
    for (const permission of previous.value) {
      const removed = services.repositories.agentRoomPermission.remove(permission);
      if (!removed.ok) return removed;
    }
    for (const permissionCode of input.permissions) {
      const added = services.repositories.agentRoomPermission.insert({ agentId: input.agentId, roomId: input.roomId,
        generation: grant.value.generation, permissionCode, grantScope: 'agent_room', grantedByMemberId: actor.principalId, grantedAt: services.clock.now() });
      if (!added.ok) return added;
    }
    const revised = services.repositories.principal.update({ ...target.value.principal, revision: input.expectedRevision + 1 });
    if (!revised.ok) return revised;
    const changed = services.repositories.agentRoomGrant.update({ ...grant.value, revision: grant.value.revision + 1, updatedAt: services.clock.now() });
    if (!changed.ok) return changed;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: input.agentId, ownerId: target.value.owner.id,
      roomId: input.roomId, membershipGeneration: grant.value.generation, permissionCode: 'room.agent.invite', action: 'room-permission.set' });
    return audit.ok ? success({ permissions: input.permissions, revision: input.expectedRevision + 1 }) : audit;
  });
}
