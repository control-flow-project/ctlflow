import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { ListenerRun } from '../activity/types.js';
import { HEARTBEAT_EXPIRY_MS } from './report.js';
import { admitsController } from './admission.js';
export type AgentActivity = {
  status: 'online' | 'offline' | 'disconnecting'; activeMs: number; messagesDelivered: number;
  lastSeenAt: number | null; activeRuns: ListenerRun[];
};
export function readActivity(services: Pick<Services, 'listenerRead' | 'clock'>, agentIds: string[]): Result<Map<string, AgentActivity>> {
  const now = services.clock.now();
  const totals = services.listenerRead.totals(agentIds), runs = services.listenerRead.admissionCandidates(agentIds, now - HEARTBEAT_EXPIRY_MS);
  if (!totals.ok) return totals; if (!runs.ok) return runs;
  const byTotal = new Map(totals.value.map(total => [total.agentId, total]));
  const byRuns = new Map<string, ListenerRun[]>();
  for (const { run, facts } of runs.value) {
    if (!admitsController(run, facts, now, 'reporting')) continue;
    const group = byRuns.get(run.agentId) ?? []; group.push(run); byRuns.set(run.agentId, group);
  }
  const result = new Map<string, AgentActivity>();
  for (const agentId of agentIds) {
    const total = byTotal.get(agentId);
    const activeRuns = byRuns.get(agentId) ?? [];
    result.set(agentId, { status: activeRuns.some(run => run.disconnectRequestedAt === null) ? 'online' : activeRuns.length ? 'disconnecting' : 'offline',
      activeMs: total?.activeMs ?? 0, messagesDelivered: total?.messagesDelivered ?? 0, lastSeenAt: total?.lastSeenAt ?? null, activeRuns });
  }
  return success(result);
}
