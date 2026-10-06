import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { AgentRoomGrant } from './types.js';

export function assignRoomPermissions(services: Pick<Services, 'repositories' | 'collection' | 'clock'>,
  grant: AgentRoomGrant, permissions: string[], grantedByMemberId: string) {
  if (permissions.length > 1 || permissions.some(code => code !== 'room.agent.invite')) return failure('invalid', 'Unsupported room-scoped permission');
  const previous = services.collection.roomPermissions(grant);
  if (!previous.ok) return previous;
  for (const permission of previous.value) {
    const removed = services.repositories.agentRoomPermission.remove(permission);
    if (!removed.ok) return removed;
  }
  for (const permissionCode of permissions) {
    const added = services.repositories.agentRoomPermission.insert({ agentId: grant.agentId, roomId: grant.roomId,
      generation: grant.generation, permissionCode, grantScope: 'agent_room', grantedByMemberId, grantedAt: services.clock.now() });
    if (!added.ok) return added;
  }
  return success(undefined);
}
