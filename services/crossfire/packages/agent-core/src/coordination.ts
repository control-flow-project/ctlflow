import type { DeliveryPolicy, PrincipalIdentity } from '@crossfire/contracts/schema/response';
import type { Manifest } from '@crossfire/contracts/release';
import type { Result } from '@crossfire/kernel/result';

export type Coordination = {
  origin: string;
  release(signal?: AbortSignal): Promise<Result<Manifest>>;
  delivery(agentId: string, signal?: AbortSignal): Promise<Result<DeliveryPolicy>>;
  acceptInvitation(agentId: string, roomId: string, signal?: AbortSignal): Promise<Result<{ accepted: boolean }>>;
  identities(matrixUserIds: readonly string[], signal?: AbortSignal): Promise<Result<PrincipalIdentity[]>>;
  report(agentId: string, runId: string, input: { release: string; messagesDelivered: number; stopped: boolean }, signal?: AbortSignal): Promise<Result<{ disconnect: boolean; currentRelease: string }>>;
  notice(agentId: string, roomId: string, eventId: string, signal?: AbortSignal): Promise<Result<{ outcome: string }>>;
};
