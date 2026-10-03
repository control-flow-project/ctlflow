import * as check from './schema/validation.js';
import { failure, success } from '@crossfire/kernel/result';

export const STATISTICS_INTERVAL_MS = 5 * 60_000;
export const STATISTICS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const STATISTICS_LIMITS = { flows: 256, sessions: 32, recentEvents: 2048 } as const;
const count = check.integer();
export const tokenCounts = check.refine(check.object({ input: count, cachedInput: count, cacheWriteInput: check.nullable(count), output: count,
  reasoningOutput: count, total: count }), value => value.cachedInput <= value.input && (value.cacheWriteInput ?? 0) <= value.input
    && value.reasoningOutput <= value.output, 'Token subsets exceed their parent counts');
export const usageSample = check.object({ runtime: check.text(100), sessionId: check.text(255), tokens: tokenCounts });
export const trafficFlow = check.object({ roomId: check.roomId, senderMatrixId: check.matrixUserId,
  messageType: check.text(100), observed: count, delivered: count, contentBytes: count, deliveredBytes: count, attachmentBytes: count, largestBytes: count });
export const statisticsBatch = check.refine(check.object({ sequence: check.integer(1), startedAt: count, endedAt: count, dropped: count,
  flows: check.list(trafficFlow, STATISTICS_LIMITS.flows), usage: check.list(usageSample, STATISTICS_LIMITS.sessions) }),
  value => value.endedAt >= value.startedAt && new Set(value.flows.map(flow => JSON.stringify([flow.roomId, flow.senderMatrixId, flow.messageType]))).size === value.flows.length
    && new Set(value.usage.map(sample => JSON.stringify([sample.runtime, sample.sessionId]))).size === value.usage.length, 'Invalid interval or duplicate summaries');
export type TokenCounts = check.Parsed<typeof tokenCounts>;
export type UsageSample = check.Parsed<typeof usageSample>;
export type TrafficFlow = check.Parsed<typeof trafficFlow>;
export type StatisticsBatch = check.Parsed<typeof statisticsBatch>;

export function statisticsQuery(input: unknown) {
  if (!(input instanceof URLSearchParams) || [...input.keys()].some(key => !['hours', 'page', 'pageSize'].includes(key) || input.getAll(key).length !== 1)) return failure('invalid', 'Unknown or duplicated statistics query');
  if (['hours', 'page', 'pageSize'].some(key => input.has(key) && !/^[1-9][0-9]*$/u.test(input.get(key)!))) return failure('invalid', 'Statistics query values must be canonical positive integers');
  const hours = Number(input.get('hours') ?? 24), page = Number(input.get('page') ?? 1), pageSize = Number(input.get('pageSize') ?? 20);
  return [1, 24, 168, 720].includes(hours) && Number.isSafeInteger(page) && page >= 1 && page <= 100000 && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100
    ? success({ hours, page, pageSize }) : failure('invalid', 'Select 1, 24, 168 or 720 hours and valid pagination');
}
const totals = check.object({ observed: count, delivered: count, contentBytes: count, deliveredBytes: count, attachmentBytes: count, largestBytes: count });
export const fleetStatistics = check.object({ capturedAt: count, since: count, retentionDays: count, intervals: count, dropped: count,
  firstReportAt: check.nullable(count), lastReportAt: check.nullable(count), totals,
  agents: check.list(check.object({ agentId: check.identifier, displayName: check.text(255), matrixUserId: check.matrixUserId, totals,
    tokens: check.nullable(tokenCounts) }), 100),
  flows: check.list(check.object({ agentId: check.identifier, senderMatrixId: check.matrixUserId, senderName: check.nullable(check.text(255)),
    roomId: check.roomId, messageType: check.text(100), ...{ totals } }), 100),
  meta: check.object({ page: count, pageSize: count, totalItems: count, totalPages: count }),
  tokens: check.nullable(tokenCounts), spend: check.nullable(check.text(100)) });
export type FleetStatistics = check.Parsed<typeof fleetStatistics>;
