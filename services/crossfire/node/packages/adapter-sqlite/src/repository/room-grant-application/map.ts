import type { RoomGrantApplication } from '@ctlflow/crossfire-domain/room-access/types';
import type { Tables } from '../../schema/tables.js';
import { readNativeAccess } from '../native-access.js';
export function mapRoomGrantApplication(row: Tables['room_grant_application']): RoomGrantApplication {
  return {
    agentId: row.agent_id,
    roomId: row.room_id,
    observedGeneration: row.observed_generation,
    appliedRevision: row.applied_revision,
    appliedAccessRevision: row.applied_access_revision,
    membership: row.membership,
    nativeAccess: readNativeAccess(row.native_access),
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}
