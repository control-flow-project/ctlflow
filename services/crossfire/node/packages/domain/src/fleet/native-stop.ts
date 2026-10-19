import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { FleetActor } from './authority.js';
import { liveFleetConnection } from './control.js';
import type { RetirementAgent, RetirementSelection } from '../port/listener-read.js';

export type NativeStop = { agentId: string; receiptId: string; sequence: number; fleetId: string; runId: string; connectionId: string;
  credentialId: string; nativeStoppedAt: number; invalidatedAt: number | null };
export type NativeStopRepository = {
  find(agentId: string): Result<NativeStop | null>;
  receipt(agentId: string, receiptId: string): Result<NativeStop | null>;
  insert(value: NativeStop): Result<void>;
  invalidate(agentId: string, now: number): Result<void>;
};
export type RetirementServices = Pick<Services, 'listenerRead' | 'clock'>;
export type RetirementEligibility = { agents: Map<string, { fleetId: string; eligible: boolean }>; fleets: Map<string, boolean>; pendingFleetIds: Set<string> };

function receiptsSettled(agent: RetirementAgent): boolean {
  return !agent.pendingDecision && !agent.pendingWake && !agent.pendingBroadcast;
}

export function canRetireAgent(agent: RetirementAgent, now: number): boolean {
  if (agent.pendingOperation || !receiptsSettled(agent)) return false;
  if (!agent.hasObservedRuntime && agent.latestRun === null) return true;
  const run = agent.latestRun, proof = agent.nativeStop, controller = agent.controller;
  return agent.ownerActive && run !== null && run.stoppedAt !== null && proof !== null && proof.invalidatedAt === null
    && proof.agentId === agent.agentId && proof.fleetId === agent.fleetId && proof.runId === run.id
    && run.controller.fleetId === agent.fleetId
    && run.controller.connectionId === proof.connectionId && run.controller.credentialId === proof.credentialId
    && controller !== null && controller.closedAt === null && controller.expiresAt > now && controller.fleetId === agent.fleetId
    && controller.connectionId === proof.connectionId && controller.credentialId === proof.credentialId
    && controller.credential !== null && controller.credential.id === proof.credentialId
    && controller.credential.fleetId === agent.fleetId && controller.credential.revokedAt === null
    && (agent.latestActiveObservationAt === null || agent.latestActiveObservationAt <= proof.nativeStoppedAt);
}

export function retirementEligibility(services: RetirementServices, selection: RetirementSelection): Result<RetirementEligibility> {
  const now = services.clock.now(), snapshot = services.listenerRead.retirement(selection, now); if (!snapshot.ok) return snapshot;
  const pendingFleetIds = new Set(snapshot.value.pendingFleetIds), agents = new Map<string, { fleetId: string; eligible: boolean }>();
  const fleets = new Map((selection.fleetIds ?? []).map(fleetId => [fleetId, !pendingFleetIds.has(fleetId)]));
  for (const agent of snapshot.value.agents) {
    const eligible = canRetireAgent(agent, now);
    agents.set(agent.agentId, { fleetId: agent.fleetId, eligible });
    fleets.set(agent.fleetId, (fleets.get(agent.fleetId) ?? !pendingFleetIds.has(agent.fleetId)) && eligible);
  }
  return success({ agents, fleets, pendingFleetIds });
}

export function settledAgentReceipts(services: RetirementServices, agentId: string) {
  const snapshot = services.listenerRead.retirement({ agentIds: [agentId] }, services.clock.now()); if (!snapshot.ok) return snapshot;
  const agent = snapshot.value.agents.find(agent => agent.agentId === agentId);
  return success(agent !== undefined && receiptsSettled(agent));
}

export function retirementEligible(services: RetirementServices, fleetId: string, agentId: string) {
  const batch = retirementEligibility(services, { agentIds: [agentId] }); if (!batch.ok) return batch;
  const agent = batch.value.agents.get(agentId);
  return success(agent?.fleetId === fleetId && agent.eligible);
}

export function recordNativeStop(services: Pick<Services, 'repositories' | 'runtime' | 'listenerRead' | 'directory' | 'collection' | 'clock' | 'unitOfWork' | 'identity'>,
  actor: FleetActor, fleetId: string, agentId: string, input: { connectionId: string; runId: string; receiptId: string }) {
  return services.unitOfWork.run(() => {
    const current = liveFleetConnection(services, actor, fleetId, input.connectionId); if (!current.ok) return current;
    const binding = services.repositories.fleetInstance.findByAgent(agentId); if (!binding.ok) return binding;
    if (!binding.value || binding.value.retiredAt !== null || binding.value.ownerId !== current.value.fleet.ownerId || binding.value.fleetKey !== current.value.fleet.fleetKey)
      return failure('forbidden', 'Native stop proof must cover this current fleet instance');
    const run = services.repositories.listenerRun.find({ id: input.runId }); if (!run.ok) return run;
    if (!run.value || run.value.agentId !== agentId || run.value.controller.fleetId !== fleetId
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
