import type Database from 'better-sqlite3';
import { executeSelect, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '../../schema/tables.js';
import type { ScanCursor } from './cursor.js';

export function pruneSessionOperations(database: Database.Database, cutoff: number, limit: number, cursor: ScanCursor | null) {
  const operations = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation')
    .where(row => (row.status === 'succeeded' || row.status === 'failed') && row.completed_at !== null && row.completed_at < params.cutoff
      && (row.completed_at > params.after || row.completed_at === params.after && row.id > params.id))
    .orderBy(row => row.completed_at).thenBy(row => row.id).take(params.limit)
    .select(row => ({ id: row.id, fleetId: row.fleet_id, agentId: row.agent_id, action: row.action, status: row.status, at: row.completed_at! })),
  { cutoff, limit, after: cursor?.at ?? Number.MIN_SAFE_INTEGER, id: cursor?.id ?? '' });
  const stops = new Map<string, string | null>(), removable: string[] = [];
  for (const operation of operations) {
    let current = false;
    if (operation.action === 'stop' && operation.status === 'succeeded') {
      const key = operation.fleetId + ':' + (operation.agentId ?? 'fleet');
      if (!stops.has(key)) {
        const latest = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation')
          .where(row => row.fleet_id === params.fleet && (params.agent === null && row.agent_id === null
            || params.agent !== null && row.agent_id === params.agent) && row.action === 'stop' && row.status === 'succeeded')
          .orderByDescending(row => row.completed_at).thenByDescending(row => row.id).take(1).select(row => ({ id: row.id })),
        { fleet: operation.fleetId, agent: operation.agentId });
        stops.set(key, latest[0]?.id ?? null);
      }
      current = stops.get(key) === operation.id;
    }
    if (!current) removable.push(operation.id);
  }
  if (removable.length) executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_runtime_operation')
    .where(row => params.ids.includes(row.id)), { ids: removable });
  const last = operations.at(-1);
  return { removed: removable.length, more: operations.length === limit,
    cursor: operations.length === limit && last ? { at: last.at, id: last.id } : null };
}
