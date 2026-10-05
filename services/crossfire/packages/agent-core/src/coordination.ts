import type { DeliveryPolicy, PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { WakeAttachment, ScheduledWake } from '@ctlflow/crossfire-contracts/wake-up';
import type { DecisionCreation, DecisionView, DecisionAnswer, RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
import type { StatisticsBatch } from '@ctlflow/crossfire-contracts/statistics';
import type { ControllerBinding } from './listener-control-port.js';

export type Coordination = {
  origin: string;
  createDecision(agentId: string, input: DecisionCreation, signal?: AbortSignal): Promise<Result<DecisionView>>;
  pollDecision(agentId: string, decisionId: string, signal?: AbortSignal): Promise<Result<{ status: DecisionView['status']; answers: DecisionAnswer[] }>>;
  receiptDecision(agentId: string, decisionId: string, status: 'responded' | 'cancelled', signal?: AbortSignal): Promise<Result<{ accepted: boolean }>>;
  runtime(agentId: string, runId: string, input: RuntimeObservation, signal?: AbortSignal): Promise<Result<{ accepted: boolean }>>;
  release(signal?: AbortSignal): Promise<Result<Manifest>>;
  delivery(agentId: string, signal?: AbortSignal): Promise<Result<DeliveryPolicy>>;
  ownerConversation(agentId: string, signal?: AbortSignal): Promise<Result<{ roomId: string }>>;
  acceptInvitation(agentId: string, roomId: string, signal?: AbortSignal): Promise<Result<{ accepted: boolean }>>;
  identities(matrixUserIds: readonly string[], signal?: AbortSignal): Promise<Result<PrincipalIdentity[]>>;
  report(agentId: string, runId: string, input: { release: string; messagesDelivered: number; stopped: boolean; controller: ControllerBinding; statistics: StatisticsBatch | null }, signal?: AbortSignal): Promise<Result<{ disconnect: boolean; currentRelease: string; statisticsAccepted: boolean }>>;
  notice(agentId: string, roomId: string, eventId: string, signal?: AbortSignal): Promise<Result<{ outcome: string }>>;
  wakeMetadata(agentId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ now: number; nextDueAt: number | null }>>;
  claimWake(agentId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<ScheduledWake | null>>;
  validateWake(agentId: string, deliveryId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ eligible: boolean }>>;
  acknowledgeWake(agentId: string, deliveryId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ recorded: boolean }>>;
};
