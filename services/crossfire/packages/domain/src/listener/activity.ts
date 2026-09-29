import { success, type Result } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import type { ListenerRun } from '../activity/types.js';
import { HEARTBEAT_EXPIRY_MS } from './report.js';
export type AgentActivity = {
  status: 'online' | 'offline' | 'disconnecting'; activeMs: number; messagesDelivered: number;
  lastSeenAt: number | null; activeRuns: ListenerRun[];
};
export function readActivity(services: Pick<Services, 'listenerRead' | 'clock'>, agentIds: string[]): Result<Map<string, AgentActivity>> {
  const totals = services.listenerRead.totals(agentIds), runs = services.listenerRead.active(agentIds, services.clock.now() - HEARTBEAT_EXPIRY_MS);
  if (!totals.ok) return totals; if (!runs.ok) return runs;
  const result = new Map<string, AgentActivity>();
  for (const agentId of agentIds) {
    const total = totals.value.find(value => value.agentId === agentId);
    const activeRuns = runs.value.filter(run => run.agentId === agentId);
    result.set(agentId, { status: activeRuns.some(run => run.disconnectRequestedAt === null) ? 'online' : activeRuns.length ? 'disconnecting' : 'offline',
      activeMs: total?.activeMs ?? 0, messagesDelivered: total?.messagesDelivered ?? 0, lastSeenAt: total?.lastSeenAt ?? null, activeRuns });
  }
  return success(result);
}
