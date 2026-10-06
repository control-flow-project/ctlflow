import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import type { StatisticsRepository, Flow, Tokens } from '@ctlflow/crossfire-domain/statistics/types';
import { success } from '@ctlflow/crossfire-kernel/result';
import { stored } from '../stored.js';

export function statisticsReader(database: Database.Database): StatisticsRepository['read'] {
  return (agentIds, since, page, pageSize) => stored(() => {
    const parameters = { agentIds, since, offset: (page - 1) * pageSize, limit: pageSize };
    const intervals = executeSelect(database, schema, (query, params) => query.from('listener_stat_interval')
      .where(row => params.agentIds.includes(row.agent_id) && row.captured_at >= params.since)
      .groupBy(row => row.agent_id).select(group => ({ agentId: group.key, count: group.count(), dropped: group.sum(row => row.dropped),
        first: group.min(row => row.captured_at), last: group.max(row => row.captured_at) })), parameters);
    const flows = executeSelect(database, schema, (query, params) => query.from('listener_stat_flow')
      .join(query.from('listener_stat_interval'), flow => flow.run_id, interval => interval.run_id, (flow, interval) => ({ flow, interval }))
      .where(row => row.flow.bucket_at === row.interval.bucket_at && params.agentIds.includes(row.interval.agent_id) && row.interval.captured_at >= params.since)
      .groupBy(row => ({ agentId: row.interval.agent_id, roomId: row.flow.room_id, senderMatrixId: row.flow.sender_matrix_id, messageType: row.flow.message_type }))
      .select(group => ({ agentId: group.key.agentId, roomId: group.key.roomId, senderMatrixId: group.key.senderMatrixId, messageType: group.key.messageType,
        observed: group.sum(row => row.flow.observed), delivered: group.sum(row => row.flow.delivered), contentBytes: group.sum(row => row.flow.content_bytes),
        deliveredBytes: group.sum(row => row.flow.delivered_bytes), attachmentBytes: group.sum(row => row.flow.attachment_bytes), largestBytes: group.max(row => row.flow.largest_bytes) }))
      .orderByDescending(row => row.observed).thenBy(row => row.senderMatrixId).thenBy(row => row.agentId).thenBy(row => row.roomId).thenBy(row => row.messageType)
      .skip(params.offset).take(params.limit), parameters);
    const totalFlows = executeSelect(database, schema, (query, params) => query.from('listener_stat_flow')
      .join(query.from('listener_stat_interval'), flow => flow.run_id, interval => interval.run_id, (flow, interval) => ({ flow, interval }))
      .where(row => row.flow.bucket_at === row.interval.bucket_at && params.agentIds.includes(row.interval.agent_id) && row.interval.captured_at >= params.since)
      .select(row => ({ agentId: row.interval.agent_id, roomId: row.flow.room_id, sender: row.flow.sender_matrix_id, type: row.flow.message_type })).distinct().count(), parameters);
    const traffic = executeSelect(database, schema, (query, params) => query.from('listener_stat_flow')
      .join(query.from('listener_stat_interval'), flow => flow.run_id, interval => interval.run_id, (flow, interval) => ({ flow, interval }))
      .where(row => row.flow.bucket_at === row.interval.bucket_at && params.agentIds.includes(row.interval.agent_id) && row.interval.captured_at >= params.since)
      .groupBy(row => row.interval.agent_id).select(group => ({ agentId: group.key,
        observed: group.sum(row => row.flow.observed), delivered: group.sum(row => row.flow.delivered), contentBytes: group.sum(row => row.flow.content_bytes),
        deliveredBytes: group.sum(row => row.flow.delivered_bytes), attachmentBytes: group.sum(row => row.flow.attachment_bytes), largestBytes: group.max(row => row.flow.largest_bytes) })), parameters);
    const usage = executeSelect(database, schema, (query, params) => query.from('listener_stat_usage')
      .join(query.from('listener_stat_interval'), sample => sample.run_id, interval => interval.run_id, (sample, interval) => ({ sample, interval }))
      .where(row => row.sample.bucket_at === row.interval.bucket_at && params.agentIds.includes(row.interval.agent_id) && row.interval.captured_at >= params.since)
      .groupBy(row => row.interval.agent_id).select(group => ({ agentId: group.key, input: group.sum(row => row.sample.input), cachedInput: group.sum(row => row.sample.cached_input),
        cacheWriteInput: group.sum(row => row.sample.cache_write_input ?? 0), unknownCacheWrite: group.sum(row => row.sample.cache_write_input === null ? 1 : 0),
        output: group.sum(row => row.sample.output), reasoningOutput: group.sum(row => row.sample.reasoning_output), total: group.sum(row => row.sample.total) })), parameters);
    const empty = () => ({ observed: 0, delivered: 0, contentBytes: 0, deliveredBytes: 0, attachmentBytes: 0, largestBytes: 0 });
    const totals = empty(), perAgent = new Map(agentIds.map(id => [id, empty()]));
    function add(target: ReturnType<typeof empty>, source: Omit<Flow, 'roomId' | 'senderMatrixId' | 'messageType'>) {
      target.observed += source.observed; target.delivered += source.delivered; target.contentBytes += source.contentBytes;
      target.deliveredBytes += source.deliveredBytes; target.attachmentBytes += source.attachmentBytes; target.largestBytes = Math.max(target.largestBytes, source.largestBytes ?? 0);
    }
    for (const flow of traffic) { add(totals, { ...flow, largestBytes: flow.largestBytes ?? 0 }); add(perAgent.get(flow.agentId)!, { ...flow, largestBytes: flow.largestBytes ?? 0 }); }
    const byUsage = new Map<string, Tokens>(), tokens: Tokens | null = usage.length ? { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 } : null;
    for (const sample of usage) {
      const counts = { input: sample.input, cachedInput: sample.cachedInput, cacheWriteInput: sample.unknownCacheWrite ? null : sample.cacheWriteInput,
        output: sample.output, reasoningOutput: sample.reasoningOutput, total: sample.total };
      byUsage.set(sample.agentId, counts);
      if (tokens) {
        tokens.input += counts.input; tokens.cachedInput += counts.cachedInput; tokens.output += counts.output; tokens.reasoningOutput += counts.reasoningOutput; tokens.total += counts.total;
        tokens.cacheWriteInput = tokens.cacheWriteInput === null || counts.cacheWriteInput === null ? null : tokens.cacheWriteInput + counts.cacheWriteInput;
      }
    }
    return success({ intervals: intervals.reduce((sum, interval) => sum + interval.count, 0), dropped: intervals.reduce((sum, interval) => sum + interval.dropped, 0),
      firstReportAt: intervals.length ? Math.min(...intervals.map(interval => interval.first!)) : null, lastReportAt: intervals.length ? Math.max(...intervals.map(interval => interval.last!)) : null,
      totals, agents: agentIds.map(agentId => ({ agentId, totals: perAgent.get(agentId)!, tokens: byUsage.get(agentId) ?? null })),
      flows: flows.map(flow => ({ ...flow, largestBytes: flow.largestBytes ?? 0 })), totalFlows, tokens });
  });
}
