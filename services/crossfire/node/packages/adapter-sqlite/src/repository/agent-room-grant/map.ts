import type { AgentRoomGrant } from '@ctlflow/crossfire-domain/room-access/types';
import type { Tables } from '../../schema/tables.js';
import { readNativeAccess } from '../native-access.js';
export function mapAgentRoomGrant(row: Tables['agent_room_grant']): AgentRoomGrant {
  return {
    agentId: row.agent_id,
    roomId: row.room_id,
    generation: row.generation,
    authorizerId: row.authorizer_id,
    addedById: row.added_by_id,
    invitationEventId: row.invitation_event_id,
    admissionKind: row.admission_kind,
    accessMode: row.access_mode,
    nativeAccess: readNativeAccess(row.native_access),
    muted: row.muted === 1,
    revision: row.revision,
    accessRevision: row.access_revision,
    updatedAt: row.updated_at,
  };
}
