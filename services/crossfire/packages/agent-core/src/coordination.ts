import type { DeliveryPolicy, PrincipalIdentity } from '@crossfire/contracts/schema/response';
import type { Manifest } from '@crossfire/contracts/release';
import type { Result } from '@crossfire/kernel/result';
import type { WakeAttachment, ScheduledWake } from '@crossfire/contracts/wake-up';

export type Coordination = {
  origin: string;
  release(signal?: AbortSignal): Promise<Result<Manifest>>;
  delivery(agentId: string, signal?: AbortSignal): Promise<Result<DeliveryPolicy>>;
  ownerConversation(agentId: string, signal?: AbortSignal): Promise<Result<{ roomId: string }>>;
  acceptInvitation(agentId: string, roomId: string, signal?: AbortSignal): Promise<Result<{ accepted: boolean }>>;
  identities(matrixUserIds: readonly string[], signal?: AbortSignal): Promise<Result<PrincipalIdentity[]>>;
  report(agentId: string, runId: string, input: { release: string; messagesDelivered: number; stopped: boolean; controllerBound: boolean }, signal?: AbortSignal): Promise<Result<{ disconnect: boolean; currentRelease: string }>>;
  notice(agentId: string, roomId: string, eventId: string, signal?: AbortSignal): Promise<Result<{ outcome: string }>>;
  wakeMetadata(agentId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ now: number; nextDueAt: number | null }>>;
  claimWake(agentId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<ScheduledWake | null>>;
  validateWake(agentId: string, deliveryId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ eligible: boolean }>>;
  acknowledgeWake(agentId: string, deliveryId: string, attachment: WakeAttachment, signal?: AbortSignal): Promise<Result<{ recorded: boolean }>>;
};
