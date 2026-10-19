import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgentRoomGrant } from './map.js';
import { stored } from '../stored.js';
import { writeNativeAccess } from '../native-access.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { AgentRoomGrantRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createAgentRoomGrantRepository(database: Database.Database): AgentRoomGrantRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_room_grant')
          .where(row => row.agent_id === params.agentId && row.room_id === params.roomId).firstOrDefault(), key);
        return success(row ? mapAgentRoomGrant(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_room_grant').values({
      agent_id: params.agentId,
      room_id: params.roomId,
      generation: params.generation,
      authorizer_id: params.authorizerId,
      added_by_id: params.addedById,
      invitation_event_id: params.invitationEventId,
      admission_kind: params.admissionKind,
      access_mode: params.accessMode,
      native_access: params.nativeAccess,
      muted: params.muted,
      revision: params.revision,
      access_revision: params.accessRevision,
      updated_at: params.updatedAt,
        }), { ...value, nativeAccess: writeNativeAccess(value.nativeAccess), muted: value.muted ? 1 : 0 });
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent_room_grant').set({
      generation: params.generation,
      authorizer_id: params.authorizerId,
      added_by_id: params.addedById,
      invitation_event_id: params.invitationEventId,
      admission_kind: params.admissionKind,
      access_mode: params.accessMode,
      native_access: params.nativeAccess,
      muted: params.muted,
      revision: params.revision,
      access_revision: params.accessRevision,
      updated_at: params.updatedAt,
        }).where(row => row.agent_id === params.agentId && row.room_id === params.roomId), { ...value, nativeAccess: writeNativeAccess(value.nativeAccess), muted: value.muted ? 1 : 0 });
        return changed === 1 ? success(undefined) : failure('missing', 'AgentRoomGrant not found');
      });
    },
  };
}
