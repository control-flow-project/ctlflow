import type Database from 'better-sqlite3';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { tableColumns } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { DAY_MS, loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export type RetentionProof = { loggingRetentionDays: number; at: number };
export function retentionProof(database: Database.Database, input?: RetentionProof) {
  const days = loggingRetentionDays(input?.loggingRetentionDays); if (!days.ok) return days;
  if (input && (!Number.isSafeInteger(input.at) || input.at < 0 || !Number.isSafeInteger(input.at - days.value * DAY_MS)))
    return failure('invalid', 'Retention preservation needs an exact UTC millisecond cutoff');
  const cutoff = input ? input.at - days.value * DAY_MS : -Infinity;
  const archives = executeSelect(database, schema, (query, params) => query.from('enrollment_archive')
    .where(row => row.created_at < params.cutoff).select(row => ({ id: row.id })).take(100001), { cutoff });
  const requests = executeSelect(database, schema, (query, params) => query.from('enrollment_request')
    .where(row => (row.status === 'expired' || row.status === 'rejected') && (row.decided_at ?? row.expires_at) < params.cutoff)
    .groupJoin(query.from('agent_name').where(row => row.request_id !== null), row => row.id, name => name.request_id, (row, names) => ({ row, names }))
    .selectMany(value => value.names.defaultIfEmpty(), (value, name) => ({ row: value.row, name }))
    .where(value => value.name.request_id === null).select(value => ({ id: value.row.id })).take(100001), { cutoff });
  const stops = executeSelect(database, schema, query => query.from('fleet_native_stop').groupBy(row => row.agent_id)
    .select(group => ({ agent: group.key, sequence: group.max(row => row.sequence) })).take(100001));
  if ([archives, requests, stops].some(rows => rows.length > 100000)) return failure('limit', 'Retention proof exceeds its finite record bound');
  const archiveIds = new Set(archives.map(row => row.id)), requestIds = new Set(requests.map(row => row.id)), latestStops = new Map(stops.map(row => [row.agent, row.sequence]));
  return success({ cutoff, eligible(table: string, row: object) {
    const record = row as Record<string, unknown>;
    if (table === 'audit_event') return typeof record.created_at === 'number' && record.created_at < cutoff;
    if (table === 'enrollment_archive') return archiveIds.has(String(record.id));
    if (table.startsWith('enrollment_archive_')) return archiveIds.has(String(record.request_id ?? record.enrollment_id));
    if (table === 'enrollment_request') return requestIds.has(String(record.id));
    if (table.startsWith('enrollment_item') || table === 'enrollment_controller_metadata') return requestIds.has(String(record.request_id ?? record.enrollment_id));
    if (table === 'fleet_native_stop') return typeof record.native_stopped_at === 'number' && record.native_stopped_at < cutoff
      && typeof record.sequence === 'number' && record.sequence < (latestStops.get(String(record.agent_id)) ?? 0);
    if (table === 'member_invitation') return typeof record.expires_at === 'number' && record.expires_at < cutoff
      && (record.consumed_by_member_id !== null || record.claim_matrix_user_id === null);
    return false;
  } });
}

export function recordIdentity(database: Database.Database, table: string) {
  if (!/^[a-z][a-z_]*$/u.test(table)) throw new Error('Invalid protected table');
  const columns = tableColumns(database, table);
  const keys = columns.filter(column => column.pk > 0).sort((left, right) => left.pk - right.pk).map(column => column.name);
  if (!keys.length) throw new Error('Protected records need a primary key');
  return (row: object) => JSON.stringify(keys.map(key => (row as Record<string, unknown>)[key]));
}
