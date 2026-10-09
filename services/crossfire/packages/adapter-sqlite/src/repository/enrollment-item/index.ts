import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapEnrollmentItem } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { EnrollmentItemRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createEnrollmentItemRepository(database: Database.Database): EnrollmentItemRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('enrollment_item')
          .where(row => row.request_id === params.requestId && row.instance_key === params.instanceKey).firstOrDefault(), key);
        return success(row ? mapEnrollmentItem(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('enrollment_item').values({
      request_id: params.requestId,
      instance_key: params.instanceKey,
      requested_name: params.requestedName,
      outcome: params.outcome,
      agent_id: params.agentId,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('enrollment_item').set({
      requested_name: params.requestedName,
      outcome: params.outcome,
      agent_id: params.agentId,
        }).where(row => row.request_id === params.requestId && row.instance_key === params.instanceKey), value);
        return changed === 1 ? success(undefined) : failure('missing', 'EnrollmentItem not found');
      });
    },
  };
}
