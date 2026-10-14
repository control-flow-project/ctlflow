import type Database from 'better-sqlite3';
import { executeSelect, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '../../schema/tables.js';

export function pruneStatistics(database: Database.Database, cutoff: number, limit: number): number[] {
  const parameters = { cutoff, limit };
  const intervals = executeSelect(database, schema, (query, params) => query.from('listener_stat_interval')
    .where(row => row.captured_at < params.cutoff).orderBy(row => row.captured_at).take(params.limit)
    .select(row => ({ run: row.run_id, bucket: row.bucket_at })), parameters);
  for (const interval of intervals) executeDelete(database, schema, (query, params) => query.deleteFrom('listener_stat_interval')
    .where(row => row.run_id === params.run && row.bucket_at === params.bucket), interval);
  const checkpoints = executeSelect(database, schema, (query, params) => query.from('listener_stat_checkpoint')
    .where(row => row.captured_at < params.cutoff).orderBy(row => row.captured_at).take(params.limit).select(row => ({ id: row.run_id })), parameters).map(row => row.id);
  if (checkpoints.length) executeDelete(database, schema, (query, params) => query.deleteFrom('listener_stat_checkpoint')
    .where(row => params.ids.includes(row.run_id)), { ids: checkpoints });
  const usage = executeSelect(database, schema, (query, params) => query.from('runtime_usage_checkpoint')
    .where(row => row.captured_at < params.cutoff).orderBy(row => row.captured_at).take(params.limit)
    .select(row => ({ agent: row.agent_id, runtime: row.runtime, session: row.session_id })), parameters);
  for (const sample of usage) executeDelete(database, schema, (query, params) => query.deleteFrom('runtime_usage_checkpoint')
    .where(row => row.agent_id === params.agent && row.runtime === params.runtime && row.session_id === params.session), sample);
  return [intervals.length, checkpoints.length, usage.length];
}
