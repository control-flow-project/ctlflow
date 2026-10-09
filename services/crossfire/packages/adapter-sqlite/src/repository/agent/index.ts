import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgent } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { AgentRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createAgentRepository(database: Database.Database): AgentRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent')
          .where(row => row.principal_id === params.principalId).firstOrDefault(), key);
        return success(row ? mapAgent(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent').values({
      principal_id: params.principalId,
      principal_kind: params.principalKind,
      owner_id: params.ownerId,
      wake_mode: params.wakeMode,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent').set({
      principal_kind: params.principalKind,
      owner_id: params.ownerId,
      wake_mode: params.wakeMode,
        }).where(row => row.principal_id === params.principalId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'Agent not found');
      });
    },
  };
}
