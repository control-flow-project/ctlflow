import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapRoomGrantApplication } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { RoomGrantApplicationRepository } from '@crossfire/domain/port/repositories';

export function createRoomGrantApplicationRepository(database: Database.Database): RoomGrantApplicationRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('room_grant_application')
          .where(row => row.agent_id === params.agentId && row.room_id === params.roomId).firstOrDefault(), key);
        return success(row ? mapRoomGrantApplication(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('room_grant_application').values({
      agent_id: params.agentId,
      room_id: params.roomId,
      observed_generation: params.observedGeneration,
      applied_revision: params.appliedRevision,
      applied_access_revision: params.appliedAccessRevision,
      membership: params.membership,
      power_level: params.powerLevel,
      last_attempt_at: params.lastAttemptAt,
      last_success_at: params.lastSuccessAt,
      next_check_at: params.nextCheckAt,
      error_code: params.errorCode,
      error_message: params.errorMessage,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('room_grant_application').set({
      observed_generation: params.observedGeneration,
      applied_revision: params.appliedRevision,
      applied_access_revision: params.appliedAccessRevision,
      membership: params.membership,
      power_level: params.powerLevel,
      last_attempt_at: params.lastAttemptAt,
      last_success_at: params.lastSuccessAt,
      next_check_at: params.nextCheckAt,
      error_code: params.errorCode,
      error_message: params.errorMessage,
        }).where(row => row.agent_id === params.agentId && row.room_id === params.roomId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'RoomGrantApplication not found');
      });
    },
  };
}
