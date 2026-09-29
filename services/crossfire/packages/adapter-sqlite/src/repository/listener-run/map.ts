import type { ListenerRun } from '@crossfire/domain/activity/types';
import type { Tables } from '../../schema/tables.js';
export function mapListenerRun(row: Tables['listener_run']): ListenerRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    release: row.release,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    activeMs: row.active_ms,
    messagesDelivered: row.messages_delivered,
    stoppedAt: row.stopped_at,
    disconnectRequestedAt: row.disconnect_requested_at,
  };
}
