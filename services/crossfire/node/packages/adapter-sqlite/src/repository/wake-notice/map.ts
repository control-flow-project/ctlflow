import type { WakeNotice } from '@ctlflow/crossfire-domain/activity/types';
import type { Tables } from '../../schema/tables.js';
export function mapWakeNotice(row: Tables['wake_notice']): WakeNotice {
  return {
    receiverAgentId: row.receiver_agent_id,
    eventId: row.event_id,
    senderBackendUserId: row.sender_backend_user_id,
    roomId: row.room_id,
    reservedAt: row.reserved_at,
    messageBody: row.message_body,
    status: row.status,
    sentAt: row.sent_at,
    nativeEventId: row.native_event_id,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}
