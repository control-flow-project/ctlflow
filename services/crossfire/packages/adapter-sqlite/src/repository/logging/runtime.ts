import type Database from 'better-sqlite3';
import { executeSelect, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '../../schema/tables.js';
import type { ScanCursor } from './cursor.js';

export function pruneRuntime(database: Database.Database, cutoff: number, limit: number): number[] {
  const parameters = { cutoff, limit };
  const decisions = executeSelect(database, schema, (query, params) => query.from('runtime_decision')
    .where(row => row.status !== 'pending' && row.status !== 'answered' && row.created_at < params.cutoff)
    .orderBy(row => row.created_at).thenBy(row => row.id).take(params.limit).select(row => ({ id: row.id })), parameters).map(row => row.id);
  if (decisions.length) {
    const ids = { ids: decisions };
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_decision_answer').where(row => params.ids.includes(row.decision_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_decision_option').where(row => params.ids.includes(row.decision_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_decision_question').where(row => params.ids.includes(row.decision_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_decision').where(row => params.ids.includes(row.id)), ids);
  }
  const incidents = executeSelect(database, schema, (query, params) => query.from('runtime_incident')
    .where(row => row.recovered_at !== null && row.recovered_at < params.cutoff)
    .groupJoin(query.from('incident_notification').where(row => row.event_id === null),
      row => row.id, notice => notice.incident_id, (row, notices) => ({ row, notices }))
    .selectMany(value => value.notices.defaultIfEmpty(), (value, notice) => ({ row: value.row, notice }))
    .where(value => value.notice.incident_id === null)
    .orderBy(value => value.row.recovered_at).thenBy(value => value.row.id)
    .select(value => ({ id: value.row.id })).take(params.limit), parameters).map(row => row.id);
  if (incidents.length) {
    const ids = { ids: incidents };
    executeDelete(database, schema, (query, params) => query.deleteFrom('incident_notification').where(row => params.ids.includes(row.incident_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_incident').where(row => params.ids.includes(row.id)), ids);
  }
  const stops = executeSelect(database, schema, (query, params) => query.from('fleet_native_stop')
    .where(row => row.native_stopped_at < params.cutoff)
    .join(query.from('fleet_native_stop').groupBy(row => row.agent_id)
      .select(group => ({ agent: group.key, sequence: group.max(row => row.sequence) })),
      row => row.agent_id, latest => latest.agent, (row, latest) => ({ row, latest }))
    .where(value => value.row.sequence < value.latest.sequence)
    .orderBy(value => value.row.native_stopped_at).thenBy(value => value.row.receipt_id)
    .select(value => ({ agent: value.row.agent_id, receipt: value.row.receipt_id })).take(params.limit), parameters);
  for (const stop of stops) executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_native_stop')
    .where(row => row.agent_id === params.agent && row.receipt_id === params.receipt), stop);
  return [decisions.length, incidents.length, stops.length];
}

export function pruneRuns(database: Database.Database, cutoff: number, limit: number, cursor: ScanCursor | null) {
  const runs = executeSelect(database, schema, (query, params) => query.from('listener_run')
    .where(row => row.last_seen_at < params.cutoff && (row.last_seen_at > params.after
      || row.last_seen_at === params.after && row.id > params.id))
    .orderBy(row => row.last_seen_at).thenBy(row => row.id).take(params.limit)
    .select(row => ({ id: row.id, agentId: row.agent_id, at: row.last_seen_at })),
  { cutoff, limit, after: cursor?.at ?? Number.MIN_SAFE_INTEGER, id: cursor?.id ?? '' });
  if (!runs.length) return { removed: 0, more: false, cursor: null };
  const parameters = { ids: runs.map(row => row.id), agents: [...new Set(runs.map(row => row.agentId))] };
  const latest = executeSelect(database, schema, (query, params, helpers) => query.from('listener_run')
    .where(row => params.agents.includes(row.agent_id)).select(row => ({ id: row.id,
      position: helpers.window(row).partitionBy(item => item.agent_id).orderByDescending(item => item.started_at)
        .thenByDescending(item => item.id).rowNumber() })).where(row => row.position === 1), parameters);
  const pins = [
    executeSelect(database, schema, (query, params) => query.from('runtime_decision').where(row => params.ids.includes(row.run_id)).select(row => ({ id: row.run_id })).distinct(), parameters),
    executeSelect(database, schema, (query, params) => query.from('wake_delivery').where(row => params.ids.includes(row.run_id)).select(row => ({ id: row.run_id })).distinct(), parameters),
    executeSelect(database, schema, (query, params) => query.from('fleet_native_stop').where(row => params.ids.includes(row.run_id)).select(row => ({ id: row.run_id })).distinct(), parameters),
    executeSelect(database, schema, (query, params) => query.from('runtime_incident').where(row => params.ids.includes(row.run_id!)).select(row => ({ id: row.run_id! })).distinct(), parameters),
    executeSelect(database, schema, (query, params) => query.from('listener_stat_interval').where(row => params.ids.includes(row.run_id)).select(row => ({ id: row.run_id })).distinct(), parameters),
    executeSelect(database, schema, (query, params) => query.from('listener_stat_checkpoint').where(row => params.ids.includes(row.run_id)).select(row => ({ id: row.run_id })).distinct(), parameters),
  ];
  const protectedRuns = new Set([...latest, ...pins.flat()].map(row => row.id));
  const removable = runs.filter(row => !protectedRuns.has(row.id)).map(row => row.id);
  if (removable.length) {
    const ids = { ids: removable };
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_setting').where(row => params.ids.includes(row.run_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_observation').where(row => params.ids.includes(row.run_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('listener_run').where(row => params.ids.includes(row.id)), ids);
  }
  const last = runs.at(-1)!;
  return { removed: removable.length, more: runs.length === limit, cursor: runs.length === limit ? { at: last.at, id: last.id } : null };
}
