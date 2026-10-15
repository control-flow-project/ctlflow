import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { ListenerReadRepository } from '@ctlflow/crossfire-domain/port/listener-read';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapListenerRun } from '../listener-run/map.js';
import { readRetirement } from './retirement.js';
import { readAdmissionCandidates } from './admission.js';
export function createListenerReadRepository(database: Database.Database): ListenerReadRepository {
  return {
    admissionCandidates(agentIds, since) { return stored(() => success(readAdmissionCandidates(database, agentIds, since))); },
    retirement(selection, now) { return stored(() => success(readRetirement(database, selection, now))); },
    activeCount(agentId, since, now) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => row.agent_id === params.agentId && row.stopped_at === null && row.last_seen_at > params.since)
        .join(query.from('fleet_connection'), run => run.controller_fleet_id, connection => connection.fleet_id, (run, connection) => ({ run, connection }))
        .where(row => row.run.controller_connection_id === row.connection.connection_id && row.run.controller_credential_id === row.connection.credential_id
          && row.connection.closed_at === null && row.connection.expires_at > params.now).count(), { agentId, since, now })));
    },
    reportingAgentIds(since, disconnecting, now) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .join(query.from('fleet_connection'), run => run.controller_fleet_id, connection => connection.fleet_id, (run, connection) => ({ run, connection }))
        .join(query.from('fleet'), row => row.run.controller_fleet_id, fleet => fleet.id, (row, fleet) => ({ ...row, fleet })).where(row => row.run.stopped_at === null && row.run.last_seen_at > params.since && (params.disconnecting === true || row.run.disconnect_requested_at === null) && row.run.controller_connection_id === row.connection.connection_id && row.run.controller_credential_id === row.connection.credential_id && row.connection.closed_at === null && row.connection.expires_at > params.now && row.fleet.archived_at === null && row.fleet.delivery_enabled === 1)
        .select(row => ({ agentId: row.run.agent_id })).distinct(), { since, disconnecting, now }).map(row => row.agentId)));
    },
    totals(agentIds) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => params.agentIds.includes(row.agent_id)).groupBy(row => row.agent_id)
        .select(group => ({ agentId: group.key, messagesDelivered: group.sum(row => row.messages_delivered),
          activeMs: group.sum(row => row.active_ms), lastSeenAt: group.max(row => row.last_seen_at) })), { agentIds })));
    },
    active(agentIds, since) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => params.agentIds.includes(row.agent_id) && row.stopped_at === null && row.last_seen_at > params.since)
        .orderBy(row => row.agent_id).thenByDescending(row => row.last_seen_at).thenBy(row => row.id), { agentIds, since }).map(mapListenerRun)));
    },
    history(agentId, input) {
      return stored(() => {
        const parameters = { agentId, offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
        const total = executeSelect(database, schema, (query, params) => query.from('listener_run').where(row => row.agent_id === params.agentId).count(), parameters);
        const rows = executeSelect(database, schema, (query, params) => query.from('listener_run').where(row => row.agent_id === params.agentId)
          .orderByDescending(row => row.started_at).thenByDescending(row => row.id).skip(params.offset).take(params.limit), parameters);
        return success(page(rows.map(mapListenerRun), total, input));
      });
    },
  };
}
