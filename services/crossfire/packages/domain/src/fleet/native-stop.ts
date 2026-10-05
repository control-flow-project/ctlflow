import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { FleetActor } from './authority.js';
import { liveFleetConnection } from './control.js';

export type NativeStop = { agentId: string; receiptId: string; sequence: number; fleetId: string; runId: string; connectionId: string;
  credentialId: string; nativeStoppedAt: number; invalidatedAt: number | null };
export type NativeStopRepository = {
  find(agentId: string): Result<NativeStop | null>;
  receipt(agentId: string, receiptId: string): Result<NativeStop | null>;
  insert(value: NativeStop): Result<void>;
  invalidate(agentId: string, now: number): Result<void>;
};
export type RetirementServices = Pick<Services, 'repositories' | 'runtime' | 'listenerRead' | 'clock'>;

export function settledAgentReceipts(services: RetirementServices, agentId: string) {
  const decisions = services.runtime.decisions(agentId, 1, 1, 'pending'); if (!decisions.ok) return decisions;
  const answered = services.runtime.decisions(agentId, 1, 1, 'answered'); if (!answered.ok) return answered;
  const wake = services.repositories.wakeDelivery.pending(agentId); if (!wake.ok) return wake;
  const delivery = services.repositories.fleetMessageDelivery.pendingForAgent(agentId, services.clock.now()); if (!delivery.ok) return delivery;
  return success(decisions.value.totalItems === 0 && answered.value.totalItems === 0 && wake.value === null && !delivery.value);
}

export function retirementEligible(services: RetirementServices, fleetId: string, agentId: string) {
  const pending = services.repositories.fleetRuntimeOperation.pending(fleetId); if (!pending.ok) return pending;
  if (pending.value) return success(false);
  const settled = settledAgentReceipts(services, agentId); if (!settled.ok || !settled.value) return settled;
  const observations = services.runtime.observation(agentId); if (!observations.ok) return observations;
  const runs = services.listenerRead.history(agentId, { page: 1, pageSize: 1 }); if (!runs.ok) return runs;
  const newest = runs.value.items[0];
  const observed = services.runtime.hasObservedRuntime(agentId); if (!observed.ok) return observed;
  if (!observed.value && !newest) return success(true);
  if (!newest || newest.stoppedAt === null) return success(false);
  const receipt = services.repositories.nativeStop.find(agentId); if (!receipt.ok) return receipt;
  if (!receipt.value || receipt.value.invalidatedAt !== null || receipt.value.fleetId !== fleetId || receipt.value.runId !== newest?.id) return success(false);
  const stoppedAt = receipt.value.nativeStoppedAt;
  return success(observations.value.every(value => value.state === 'sleeping' || value.state === 'unavailable' || value.observedAt <= stoppedAt));
}

export function recordNativeStop(services: Pick<Services, 'repositories' | 'runtime' | 'listenerRead' | 'directory' | 'collection' | 'clock' | 'unitOfWork' | 'identity'>,
  actor: FleetActor, fleetId: string, agentId: string, input: { connectionId: string; runId: string; receiptId: string }) {
  return services.unitOfWork.run(() => {
    const current = liveFleetConnection(services, actor, fleetId, input.connectionId); if (!current.ok) return current;
    const binding = services.repositories.fleetInstance.findByAgent(agentId); if (!binding.ok) return binding;
    if (!binding.value || binding.value.retiredAt !== null || binding.value.ownerId !== current.value.fleet.ownerId || binding.value.fleetKey !== current.value.fleet.fleetKey)
      return failure('forbidden', 'Native stop proof must cover this current fleet instance');
    const run = services.repositories.listenerRun.find({ id: input.runId }); if (!run.ok) return run;
    if (!run.value || run.value.agentId !== agentId || run.value.controller?.fleetId !== fleetId
      || run.value.controller.connectionId !== input.connectionId || run.value.controller.credentialId !== current.value.connection.credentialId)
      return failure('conflict', 'Native stop proof requires the current authenticated listener generation');
    if (run.value.stoppedAt === null) return failure('conflict', 'Stop delivery for this listener generation before recording native close');
    const runs = services.listenerRead.history(agentId, { page: 1, pageSize: 1 }); if (!runs.ok) return runs;
    if (runs.value.items[0]?.id !== input.runId) return failure('conflict', 'Native stop proof must cover the latest listener run');
    const existing = services.repositories.nativeStop.receipt(agentId, input.receiptId); if (!existing.ok) return existing;
    if (existing.value) return existing.value.runId === input.runId && existing.value.connectionId === input.connectionId
      && existing.value.credentialId === current.value.connection.credentialId && existing.value.invalidatedAt === null
      ? success({ recorded: true }) : failure('conflict', 'This native stop receipt is obsolete or belongs to another generation');
    const settled = settledAgentReceipts(services, agentId); if (!settled.ok) return settled;
    if (!settled.value) return failure('conflict', 'Settle native decisions and wake receipts before reporting a native stop');
    const previous = services.repositories.nativeStop.find(agentId); if (!previous.ok) return previous;
    const saved = services.repositories.nativeStop.insert({ agentId, fleetId, receiptId: input.receiptId, sequence: (previous.value?.sequence ?? 0) + 1,
      runId: input.runId, connectionId: input.connectionId, credentialId: current.value.connection.credentialId,
      nativeStoppedAt: services.clock.now(), invalidatedAt: null });
    return saved.ok ? success({ recorded: true }) : saved;
  });
}
