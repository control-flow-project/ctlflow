import type Database from 'better-sqlite3';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { summarizeNative } from '@ctlflow/crossfire-domain/runtime/summary';
import type { NativeRuntimeSummary } from '@ctlflow/crossfire-domain/runtime/values';
import { schema } from '../../schema/tables.js';

export function nativeSummaries(database: Database.Database, agentIds: string[]): Map<string, NativeRuntimeSummary> {
  const summaries = new Map<string, NativeRuntimeSummary>();
  if (!agentIds.length) return summaries;
  const runs = executeSelect(database, schema, (query, params, helpers) => query.from('listener_run')
    .where(row => params.agentIds.includes(row.agent_id))
    .select(row => ({ id: row.id, agentId: row.agent_id, fleetId: row.controller_fleet_id, startedAt: row.started_at, stoppedAt: row.stopped_at,
      position: helpers.window(row).partitionBy(item => item.agent_id).orderByDescending(item => item.started_at)
        .thenByDescending(item => item.id).rowNumber() }))
    .where(row => row.position === 1), { agentIds });
  if (!runs.length) return summaries;
  const rows = executeSelect(database, schema, (query, params) => query.from('runtime_observation')
    .where(row => params.runIds.includes(row.run_id))
    .select(row => ({ agentId: row.agent_id, state: row.state, observedAt: row.observed_at, lastActivityAt: row.last_activity_at,
      historyAvailable: row.history_available })), { runIds: runs.map(run => run.id) });
  const groups = new Map<string, Parameters<typeof summarizeNative>[0]>();
  for (const row of rows) {
    const group = groups.get(row.agentId) ?? [];
    group.push({ ...row, historyAvailable: row.historyAvailable === null ? null : row.historyAvailable === 1 });
    groups.set(row.agentId, group);
  }
  for (const [agentId, values] of groups) { const summary = summarizeNative(values); if (summary) summaries.set(agentId, summary); }
  const stoppedRuns = runs.filter(run => run.stoppedAt !== null);
  if (!stoppedRuns.length) return summaries;
  const runIds = stoppedRuns.map(run => run.id);
  const receipts = executeSelect(database, schema, (query, params) => query.from('fleet_native_stop')
    .where(row => params.runIds.includes(row.run_id) && row.invalidated_at === null)
    .groupBy(row => row.run_id)
    .select(group => ({ runId: group.key, stoppedAt: group.max(row => row.native_stopped_at) })), { runIds });
  const proofs = new Map(receipts.map(receipt => [receipt.runId, receipt.stoppedAt]));
  const stops = executeSelect(database, schema, (query, params) => query.from('listener_run')
    .where(row => params.runIds.includes(row.id))
    .join(query.from('fleet_runtime_operation'), run => run.controller_fleet_id, operation => operation.fleet_id,
      (run, operation) => ({ run, operation }))
    .where(row => row.operation.action === 'stop' && row.operation.status === 'succeeded'
      && (row.operation.agent_id === null || row.operation.agent_id === row.run.agent_id))
    .groupBy(row => ({ agentId: row.run.agent_id, fleetId: row.run.controller_fleet_id }))
    .select(group => ({ agentId: group.key.agentId, fleetId: group.key.fleetId, completedAt: group.max(row => row.operation.completed_at) })), { runIds });
  const operations = new Map(stops.map(stop => [stop.agentId, stop]));
  for (const run of stoppedRuns) {
    const proof = proofs.get(run.id);
    const operation = operations.get(run.agentId);
    const completedAt = operation?.fleetId === run.fleetId && operation.completedAt !== null && operation.completedAt >= run.stoppedAt!
      ? operation.completedAt : null;
    const times = [...(proof === undefined || proof === null ? [] : [proof]), ...(completedAt === null ? [] : [completedAt])];
    if (!times.length) continue;
    const summary = summaries.get(run.agentId);
    summaries.set(run.agentId, { state: 'stopped', observedAt: Math.max(...times), lastActivityAt: summary?.lastActivityAt ?? null,
      historyAvailable: summary?.historyAvailable ?? null });
  }
  return summaries;
}
