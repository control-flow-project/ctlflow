import type { ListenerRun } from '@ctlflow/crossfire-domain/activity/types';
import type { Tables } from '../../schema/tables.js';
export function mapListenerRun(row: Tables['listener_run']): ListenerRun {
  return {
    controller: row.controller_fleet_id !== null && row.controller_connection_id !== null && row.controller_credential_id !== null
      ? { fleetId: row.controller_fleet_id, connectionId: row.controller_connection_id, credentialId: row.controller_credential_id } : null,
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
