import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgentRoomPermission } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { AgentRoomPermissionRepository } from '@crossfire/domain/port/repositories';

export function createAgentRoomPermissionRepository(database: Database.Database): AgentRoomPermissionRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_room_permission')
          .where(row => row.agent_id === params.agentId && row.room_id === params.roomId && row.permission_code === params.permissionCode).firstOrDefault(), key);
        return success(row ? mapAgentRoomPermission(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_room_permission').values({
      agent_id: params.agentId,
      room_id: params.roomId,
      generation: params.generation,
      permission_code: params.permissionCode,
      grant_scope: params.grantScope,
      granted_by_member_id: params.grantedByMemberId,
      granted_at: params.grantedAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent_room_permission').set({
      generation: params.generation,
      grant_scope: params.grantScope,
      granted_by_member_id: params.grantedByMemberId,
      granted_at: params.grantedAt,
        }).where(row => row.agent_id === params.agentId && row.room_id === params.roomId && row.permission_code === params.permissionCode), value);
        return changed === 1 ? success(undefined) : failure('missing', 'AgentRoomPermission not found');
      });
    },
    remove(key) {
      return stored(() => {
        executeDelete(database, schema, (query, params) => query.deleteFrom('agent_room_permission')
          .where(row => row.agent_id === params.agentId && row.room_id === params.roomId && row.permission_code === params.permissionCode), key);
        return success(undefined);
      });
    },
  };
}
