import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import type { StatisticsBatch } from '../statistics/types.js';
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_EXPIRY_MS = 90_000;
export function reportListener(services: Pick<Services, 'statistics' | 'repositories' | 'directory' | 'listenerRead' | 'unitOfWork' | 'clock'>,
  actor: Actor, agentId: string, runId: string, input: { release: string; messagesDelivered: number; stopped: boolean; controllerBound: boolean; statistics: StatisticsBatch | null }, currentRelease: string) {
  if (!/^[a-f0-9-]{36}$/u.test(runId) || !input.release || input.release.length > 200
    || typeof input.controllerBound !== 'boolean' || !Number.isSafeInteger(input.messagesDelivered) || input.messagesDelivered < 0) return failure('invalid', 'Invalid listener report');
  const report = services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'listener.report.self');
    if (!authority.ok) return authority;
    if (actor.principalId !== agentId) return failure('missing', 'Listener agent not found');
    const previous = services.repositories.listenerRun.find({ id: runId });
    if (!previous.ok) return previous;
    if (previous.value && previous.value.agentId !== agentId) return failure('missing', 'Listener run not found');
    if (previous.value && previous.value.stoppedAt !== null) return success({ disconnect: true, currentRelease, closed: true });
    if (previous.value && previous.value.release !== input.release) return failure('conflict', 'A running listener cannot change its software version');
    if (previous.value && previous.value.controllerBound !== input.controllerBound) return failure('conflict', 'A running listener cannot change its controller binding');
    if (!previous.value && input.release !== currentRelease) return failure('conflict', 'Update the project-local Crossfire client and skill before reconnecting. Current release: ' + currentRelease);
    const now = services.clock.now();
    const elapsed = previous.value ? Math.max(0, now - previous.value.lastSeenAt) : 0;
    const record = { id: runId, agentId, release: input.release, controllerBound: input.controllerBound, startedAt: previous.value?.startedAt ?? now,
      lastSeenAt: Math.max(now, previous.value?.lastSeenAt ?? now),
      activeMs: (previous.value?.activeMs ?? 0) + (elapsed <= HEARTBEAT_EXPIRY_MS ? elapsed : 0),
      messagesDelivered: Math.max(previous.value?.messagesDelivered ?? 0, input.messagesDelivered),
      stoppedAt: input.stopped ? now : null, disconnectRequestedAt: previous.value?.disconnectRequestedAt ?? null };
    if (!Number.isSafeInteger(record.activeMs)) return failure('limit', 'Listener active duration exceeds the exact integer range');
    if (!previous.value) {
      const runs = services.listenerRead.activeCount(agentId, now - HEARTBEAT_EXPIRY_MS);
      if (!runs.ok) return runs;
      if (runs.value >= 100) return failure('limit', 'Too many reporting listeners');
    }
    const saved = previous.value ? services.repositories.listenerRun.update(record) : services.repositories.listenerRun.insert(record);
    return saved.ok ? success({ disconnect: record.disconnectRequestedAt !== null, currentRelease, closed: false }) : saved;
  });
  if (!report.ok) return report;
  const statisticsAccepted = !report.value.closed && (input.statistics === null || services.unitOfWork.run(() =>
    services.statistics.record(agentId, runId, input.statistics!, services.clock.now())).ok);
  return success({ disconnect: report.value.disconnect, currentRelease, statisticsAccepted });
}
