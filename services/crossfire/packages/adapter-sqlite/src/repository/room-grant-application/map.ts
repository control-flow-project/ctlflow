import type { RoomGrantApplication } from '@crossfire/domain/room-access/types';
import type { Tables } from '../../schema/tables.js';
export function mapRoomGrantApplication(row: Tables['room_grant_application']): RoomGrantApplication {
  return {
    agentId: row.agent_id,
    roomId: row.room_id,
    observedGeneration: row.observed_generation,
    appliedRevision: row.applied_revision,
    appliedAccessRevision: row.applied_access_revision,
    membership: row.membership,
    creator: row.creator === 1,
    powerLevel: row.power_level,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}
