import type { AgentRoomPermission } from '@crossfire/domain/room-access/types';
import type { Tables } from '../../schema/tables.js';
export function mapAgentRoomPermission(row: Tables['agent_room_permission']): AgentRoomPermission {
  return {
    agentId: row.agent_id,
    roomId: row.room_id,
    generation: row.generation,
    permissionCode: row.permission_code,
    grantScope: row.grant_scope,
    grantedByMemberId: row.granted_by_member_id,
    grantedAt: row.granted_at,
  };
}
