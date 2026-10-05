import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapListenerRun } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { ListenerRunRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createListenerRunRepository(database: Database.Database): ListenerRunRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('listener_run')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapListenerRun(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('listener_run').values({
      controller_bound: params.controllerBound,
      id: params.id,
      agent_id: params.agentId,
      release: params.release,
      started_at: params.startedAt,
      last_seen_at: params.lastSeenAt,
      active_ms: params.activeMs,
      messages_delivered: params.messagesDelivered,
      stopped_at: params.stoppedAt,
      disconnect_requested_at: params.disconnectRequestedAt,
        }), { ...value, controllerBound: value.controllerBound ? 1 : 0 });
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('listener_run').set({
      controller_bound: params.controllerBound,
      agent_id: params.agentId,
      release: params.release,
      started_at: params.startedAt,
      last_seen_at: params.lastSeenAt,
      active_ms: params.activeMs,
      messages_delivered: params.messagesDelivered,
      stopped_at: params.stoppedAt,
      disconnect_requested_at: params.disconnectRequestedAt,
        }).where(row => row.id === params.id), { ...value, controllerBound: value.controllerBound ? 1 : 0 });
        return changed === 1 ? success(undefined) : failure('missing', 'ListenerRun not found');
      });
    },
  };
}
