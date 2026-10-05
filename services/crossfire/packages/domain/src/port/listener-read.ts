import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from './directory.js';
import type { ListenerRun } from '../activity/types.js';
export type ActivityTotals = { agentId: string; messagesDelivered: number; activeMs: number; lastSeenAt: number | null };
export type ListenerReadRepository = {
  activeCount(agentId: string, since: number, now: number): Result<number>;
  reportingAgentIds(since: number, disconnecting: boolean, now: number): Result<string[]>;
  totals(agentIds: string[]): Result<ActivityTotals[]>;
  active(agentIds: string[], since: number): Result<ListenerRun[]>;
  history(agentId: string, page: PageRequest): Result<Page<ListenerRun>>;
};
