import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { ListenerReadRepository } from '@ctlflow/crossfire-domain/port/listener-read';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapListenerRun } from '../listener-run/map.js';
export function createListenerReadRepository(database: Database.Database): ListenerReadRepository {
  return {
    activeCount(agentId, since) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => row.agent_id === params.agentId && row.stopped_at === null && row.last_seen_at > params.since).count(), { agentId, since })));
    },
    reportingAgentIds(since, disconnecting) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => row.stopped_at === null && row.last_seen_at > params.since && (params.disconnecting === true || row.disconnect_requested_at === null))
        .select(row => ({ agentId: row.agent_id })).distinct(), { since, disconnecting }).map(row => row.agentId)));
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
          .orderByDescending(row => row.started_at).thenBy(row => row.id).skip(params.offset).take(params.limit), parameters);
        return success(page(rows.map(mapListenerRun), total, input));
      });
    },
  };
}
