import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgentName } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { AgentNameRepository } from '@crossfire/domain/port/repositories';

export function createAgentNameRepository(database: Database.Database): AgentNameRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_name')
          .where(row => row.name === params.name).firstOrDefault(), key);
        return success(row ? mapAgentName(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_name').values({
      name: params.name,
      request_id: params.requestId,
      instance_key: params.instanceKey,
      agent_id: params.agentId,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent_name').set({
      request_id: params.requestId,
      instance_key: params.instanceKey,
      agent_id: params.agentId,
        }).where(row => row.name === params.name), value);
        return changed === 1 ? success(undefined) : failure('missing', 'AgentName not found');
      });
    },
    remove(key) {
      return stored(() => {
        executeDelete(database, schema, (query, params) => query.deleteFrom('agent_name')
          .where(row => row.name === params.name), key);
        return success(undefined);
      });
    },
  };
}
