import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapWakeNotice } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { WakeNoticeRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createWakeNoticeRepository(database: Database.Database): WakeNoticeRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('wake_notice')
          .where(row => row.receiver_agent_id === params.receiverAgentId && row.event_id === params.eventId).firstOrDefault(), key);
        return success(row ? mapWakeNotice(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('wake_notice').values({
      receiver_agent_id: params.receiverAgentId,
      event_id: params.eventId,
      sender_matrix_id: params.senderMatrixId,
      room_id: params.roomId,
      reserved_at: params.reservedAt,
      message_body: params.messageBody,
      status: params.status,
      sent_at: params.sentAt,
      native_event_id: params.nativeEventId,
      next_attempt_at: params.nextAttemptAt,
      last_error: params.lastError,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('wake_notice').set({
      sender_matrix_id: params.senderMatrixId,
      room_id: params.roomId,
      reserved_at: params.reservedAt,
      message_body: params.messageBody,
      status: params.status,
      sent_at: params.sentAt,
      native_event_id: params.nativeEventId,
      next_attempt_at: params.nextAttemptAt,
      last_error: params.lastError,
        }).where(row => row.receiver_agent_id === params.receiverAgentId && row.event_id === params.eventId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'WakeNotice not found');
      });
    },
  };
}
