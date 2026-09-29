import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgentWakeSender } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { AgentWakeSenderRepository } from '../../../../domain/src/port/repositories.js';

export function createAgentWakeSenderRepository(database: Database.Database): AgentWakeSenderRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_wake_sender')
          .where(row => row.agent_id === params.agentId && row.sender_principal_id === params.senderPrincipalId).firstOrDefault(), key);
        return success(row ? mapAgentWakeSender(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_wake_sender').values({
      agent_id: params.agentId,
      sender_principal_id: params.senderPrincipalId,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent_wake_sender').set({
      agent_id: params.agentId,
        }).where(row => row.agent_id === params.agentId && row.sender_principal_id === params.senderPrincipalId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'AgentWakeSender not found');
      });
    },
    remove(key) {
      return stored(() => {
        executeDelete(database, schema, (query, params) => query.deleteFrom('agent_wake_sender')
          .where(row => row.agent_id === params.agentId && row.sender_principal_id === params.senderPrincipalId), key);
        return success(undefined);
      });
    },
  };
}
