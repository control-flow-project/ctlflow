import { createHash } from 'node:crypto';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema, type Tables } from '../../schema/tables.js';
import type { StatisticsBatch, Tokens } from '@ctlflow/crossfire-domain/statistics/types';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { stored } from '../stored.js';

function counters(value: Tokens) {
  return { input: value.input, cached_input: value.cachedInput, cache_write_input: value.cacheWriteInput,
    output: value.output, reasoning_output: value.reasoningOutput, total: value.total };
}
function add(first: number, second: number): number {
  const value = first + second;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Statistics counter overflow');
  return value;
}
function delta(value: Tokens, before: Tables['runtime_usage_checkpoint'] | null | undefined) {
  const latest = counters(value);
  if (before && Object.entries(latest).some(([key, current]) => current !== null
    && before[key as keyof typeof latest] !== null && current < before[key as keyof typeof latest]!)) return null;
  return { input: before ? latest.input - before.input : 0, cached_input: before ? latest.cached_input - before.cached_input : 0,
    cache_write_input: before && latest.cache_write_input !== null && before.cache_write_input !== null ? latest.cache_write_input - before.cache_write_input : null,
    output: before ? latest.output - before.output : 0, reasoning_output: latest.reasoning_output === null || before?.reasoning_output === null ? null
      : before ? latest.reasoning_output - before.reasoning_output! : 0,
    total: before ? latest.total - before.total : 0 };
}
export function statisticsRecorder(database: Database.Database) {
  return (agentId: string, runId: string, batch: StatisticsBatch, now: number) => stored(() => {
    const digest = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
    const checkpoint = executeSelect(database, schema, (query, params) => query.from('listener_stat_checkpoint')
      .where(row => row.run_id === params.runId).firstOrDefault(), { runId });
    if (checkpoint && batch.sequence <= checkpoint.sequence) return batch.sequence === checkpoint.sequence && digest === checkpoint.digest
      ? success(undefined) : failure('conflict', 'Statistics sequence is stale or has different content');
    const bucketAt = Math.floor(now / 3_600_000) * 3_600_000, key = { runId, bucketAt };
    const interval = executeSelect(database, schema, (query, params) => query.from('listener_stat_interval')
      .where(row => row.run_id === params.runId && row.bucket_at === params.bucketAt).firstOrDefault(), key);
    if (interval && interval.agent_id !== agentId) return failure('conflict', 'Statistics belong to another agent');
    if (!interval) executeInsert(database, schema, (query, params) => query.insertInto('listener_stat_interval').values({ run_id: params.runId,
      bucket_at: params.bucketAt, agent_id: params.agentId, started_at: params.startedAt, ended_at: params.endedAt, captured_at: params.now, dropped: 0 }),
    { ...key, agentId, startedAt: batch.startedAt, endedAt: batch.endedAt, now });
    let dropped = batch.dropped;
    for (const flow of batch.flows) {
      const identity = { ...key, ...flow };
      const previous = executeSelect(database, schema, (query, params) => query.from('listener_stat_flow')
        .where(row => row.run_id === params.runId && row.bucket_at === params.bucketAt && row.room_id === params.roomId
          && row.sender_matrix_id === params.senderMatrixId && row.message_type === params.messageType).firstOrDefault(), identity);
      if (previous) executeUpdate(database, schema, (query, params) => query.update('listener_stat_flow').set({ observed: params.observed,
        delivered: params.delivered, content_bytes: params.contentBytes, delivered_bytes: params.deliveredBytes,
        attachment_bytes: params.attachmentBytes, largest_bytes: params.largestBytes }).where(row => row.run_id === params.runId
          && row.bucket_at === params.bucketAt && row.room_id === params.roomId && row.sender_matrix_id === params.senderMatrixId && row.message_type === params.messageType),
      { ...identity, observed: add(previous.observed, flow.observed), delivered: add(previous.delivered, flow.delivered),
        contentBytes: add(previous.content_bytes, flow.contentBytes), deliveredBytes: add(previous.delivered_bytes, flow.deliveredBytes),
        attachmentBytes: add(previous.attachment_bytes, flow.attachmentBytes), largestBytes: Math.max(previous.largest_bytes, flow.largestBytes) });
      else executeInsert(database, schema, (query, params) => query.insertInto('listener_stat_flow').values({ run_id: params.runId,
        bucket_at: params.bucketAt, room_id: params.roomId, sender_matrix_id: params.senderMatrixId, message_type: params.messageType,
        observed: params.observed, delivered: params.delivered, content_bytes: params.contentBytes, delivered_bytes: params.deliveredBytes,
        attachment_bytes: params.attachmentBytes, largest_bytes: params.largestBytes }), identity);
    }
    for (const sample of batch.usage) {
      const identity = { agentId, runtime: sample.runtime, sessionId: sample.sessionId };
      const previous = executeSelect(database, schema, (query, params) => query.from('runtime_usage_checkpoint')
        .where(row => row.agent_id === params.agentId && row.runtime === params.runtime && row.session_id === params.sessionId).firstOrDefault(), identity);
      const difference = delta(sample.tokens, previous);
      if (!difference) { dropped++; continue; }
      const existing = executeSelect(database, schema, (query, params) => query.from('listener_stat_usage')
        .where(row => row.run_id === params.runId && row.bucket_at === params.bucketAt && row.runtime === params.runtime && row.session_id === params.sessionId).firstOrDefault(), { ...key, ...identity });
      const counts = { ...key, ...identity, input: add(existing?.input ?? 0, difference.input), cached_input: add(existing?.cached_input ?? 0, difference.cached_input),
        cache_write_input: existing ? existing.cache_write_input === null || difference.cache_write_input === null ? null
          : add(existing.cache_write_input, difference.cache_write_input) : difference.cache_write_input,
        output: add(existing?.output ?? 0, difference.output), reasoning_output: existing?.reasoning_output === null || difference.reasoning_output === null ? null
          : add(existing?.reasoning_output ?? 0, difference.reasoning_output), total: add(existing?.total ?? 0, difference.total) };
      if (existing) executeUpdate(database, schema, (query, params) => query.update('listener_stat_usage').set({ input: params.input,
        cached_input: params.cached_input, cache_write_input: params.cache_write_input, output: params.output, reasoning_output: params.reasoning_output, total: params.total })
        .where(row => row.run_id === params.runId && row.bucket_at === params.bucketAt && row.runtime === params.runtime && row.session_id === params.sessionId), counts);
      else executeInsert(database, schema, (query, params) => query.insertInto('listener_stat_usage').values({ run_id: params.runId,
        bucket_at: params.bucketAt, runtime: params.runtime, session_id: params.sessionId, input: params.input, cached_input: params.cached_input,
        cache_write_input: params.cache_write_input, output: params.output, reasoning_output: params.reasoning_output, total: params.total }), counts);
      const latest = { ...identity, ...counters(sample.tokens), now };
      if (previous) executeUpdate(database, schema, (query, params) => query.update('runtime_usage_checkpoint').set({ input: params.input,
        cached_input: params.cached_input, cache_write_input: params.cache_write_input, output: params.output, reasoning_output: params.reasoning_output,
        total: params.total, captured_at: params.now }).where(row => row.agent_id === params.agentId && row.runtime === params.runtime && row.session_id === params.sessionId), latest);
      else executeInsert(database, schema, (query, params) => query.insertInto('runtime_usage_checkpoint').values({ agent_id: params.agentId,
        runtime: params.runtime, session_id: params.sessionId, input: params.input, cached_input: params.cached_input, cache_write_input: params.cache_write_input,
        output: params.output, reasoning_output: params.reasoning_output, total: params.total, captured_at: params.now }), latest);
    }
    const parameters = { ...key, agentId, startedAt: Math.min(interval?.started_at ?? batch.startedAt, batch.startedAt),
      endedAt: Math.max(interval?.ended_at ?? batch.endedAt, batch.endedAt), now, dropped: add(interval?.dropped ?? 0, dropped) };
    executeUpdate(database, schema, (query, params) => query.update('listener_stat_interval').set({ started_at: params.startedAt,
      ended_at: params.endedAt, captured_at: params.now, dropped: params.dropped }).where(row => row.run_id === params.runId && row.bucket_at === params.bucketAt), parameters);
    const receipt = { runId, sequence: batch.sequence, digest, now };
    if (checkpoint) executeUpdate(database, schema, (query, params) => query.update('listener_stat_checkpoint').set({ sequence: params.sequence,
      digest: params.digest, captured_at: params.now }).where(row => row.run_id === params.runId), receipt);
    else executeInsert(database, schema, (query, params) => query.insertInto('listener_stat_checkpoint').values({ run_id: params.runId,
      sequence: params.sequence, digest: params.digest, captured_at: params.now }), receipt);
    return success(undefined);
  });
}
