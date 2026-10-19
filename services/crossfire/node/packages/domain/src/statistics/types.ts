import type { Result } from '@ctlflow/crossfire-kernel/result';

export type Tokens = { input: number; cachedInput: number; cacheWriteInput: number | null; output: number; reasoningOutput: number | null; total: number };
export type Usage = { runtime: string; sessionId: string; tokens: Tokens };
export type Flow = { roomId: string; senderBackendUserId: string; messageType: string; observed: number; delivered: number; contentBytes: number; deliveredBytes: number; attachmentBytes: number; largestBytes: number };
export type StatisticsBatch = { sequence: number; startedAt: number; endedAt: number; dropped: number; flows: Flow[]; usage: Usage[] };
export type StatisticsRepository = {
  record(agentId: string, runId: string, batch: StatisticsBatch, now: number): Result<void>;
  read(agentIds: string[], since: number, page: number, pageSize: number): Result<{
    intervals: number; dropped: number; firstReportAt: number | null; lastReportAt: number | null;
    totals: Omit<Flow, 'roomId' | 'senderBackendUserId' | 'messageType'>;
    agents: { agentId: string; totals: Omit<Flow, 'roomId' | 'senderBackendUserId' | 'messageType'>; tokens: Tokens | null }[];
    flows: (Flow & { agentId: string })[]; totalFlows: number; tokens: Tokens | null;
  }>;
};
