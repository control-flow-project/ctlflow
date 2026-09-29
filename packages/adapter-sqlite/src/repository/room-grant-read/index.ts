import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import type { RoomGrantReadRepository } from '../../../../domain/src/port/room-grant-read.js';
import { success } from '../../../../kernel/src/result.js';
import { schema } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapAgentRoomGrant } from '../agent-room-grant/map.js';
import { mapAgentRoomPermission } from '../agent-room-permission/map.js';
import { mapRoomGrantApplication } from '../room-grant-application/map.js';
export function createRoomGrantReadRepository(database: Database.Database): RoomGrantReadRepository {
  return {
    page(agentId, input) {
      return stored(() => {
        const parameters = { agentId, offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
        const count = executeSelect(database, schema, (query, params) => query.from('agent_room_grant').where(row => row.agent_id === params.agentId).count(), parameters);
        const rows = executeSelect(database, schema, (query, params) => query.from('agent_room_grant').where(row => row.agent_id === params.agentId)
          .orderBy(row => row.room_id).skip(params.offset).take(params.limit), parameters);
        return success(page(rows.map(mapAgentRoomGrant), count, input));
      });
    },
    applications(agentId, roomIds) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('room_grant_application')
        .where(row => row.agent_id === params.agentId && params.roomIds.includes(row.room_id)).orderBy(row => row.room_id), { agentId, roomIds }).map(mapRoomGrantApplication)));
    },
    permissions(agentId, roomIds) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_room_permission')
        .where(row => row.agent_id === params.agentId && params.roomIds.includes(row.room_id)).orderBy(row => row.room_id).thenBy(row => row.permission_code),
        { agentId, roomIds }).map(mapAgentRoomPermission)));
    },
  };
}
