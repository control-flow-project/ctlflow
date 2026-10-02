import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { AgentRoomGrant } from './types.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import type { RoomFacts, RoomInvitation } from '../port/matrix-authority.js';
import { protectOwnerConversation } from '../owner-conversation/protect.js';

export type GrantIntent = { accessMode: AgentRoomGrant['accessMode']; powerLevel: number | null; muted: boolean };
export type GrantChange = GrantIntent & { agentId: string; roomId: string; expectedRevision: number; expectedGeneration: string | null };
export type GrantAuthorization = {
  input: GrantChange; previous: AgentRoomGrant | null;
  actorRevision: number; targetRevision: number; ownerRevision: number;
  inviterGeneration: string | null; inviterRevision: number | null; authorizerId: string;
  native: RoomFacts | null; changed: boolean;
  invitationEventId: string | null;
  admissionKind: AgentRoomGrant['admissionKind'];
};
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'clock' | 'matrix'>;

export function sameGrant(left: GrantIntent, right: GrantIntent): boolean {
  return left.accessMode === right.accessMode && left.powerLevel === right.powerLevel && left.muted === right.muted;
}
export function requestedPower(facts: RoomFacts, intent: GrantIntent): Result<number> {
  const level = intent.accessMode === 'read' ? facts.readLevel : intent.accessMode === 'custom' ? intent.powerLevel : facts.replyLevel;
  if (level === null || !Number.isSafeInteger(level)) return failure('invalid', 'A finite integer Matrix power level is required');
  return facts.creator || level <= facts.powerLevel ? success(level) : failure('forbidden', 'Requested access exceeds the authorizer’s native room permissions');
}
export async function authorizeGrantChange(services: Dependencies, actor: Actor, input: GrantChange, invitation: RoomInvitation | null = null): Promise<Result<GrantAuthorization>> {
  const acting = activeActor(services, actor);
  if (!acting.ok) return acting;
  const protectedAccess = protectOwnerConversation(services, input);
  if (!protectedAccess.ok) return protectedAccess;
  const target = services.directory.agent(input.agentId);
  if (!target.ok) return target;
  if (!target.value) return failure('missing', 'Target agent not found');
  if (input.accessMode !== 'none' && (target.value.principal.status !== 'active' || target.value.owner.status !== 'active')) return failure('forbidden', 'Target and its owner must be active');
  if (target.value.principal.revision !== input.expectedRevision) return failure('conflict', 'Agent revision changed');
  if ((input.accessMode === 'custom') !== (input.powerLevel !== null) || input.powerLevel !== null && !Number.isSafeInteger(input.powerLevel)
    || input.accessMode === 'none' && input.muted) return failure('invalid', 'Invalid room access settings');
  const stored = services.repositories.agentRoomGrant.find({ agentId: input.agentId, roomId: input.roomId });
  if (!stored.ok) return stored;
  const previous = stored.value;
  const freshInvitation = invitation !== null && invitation.eventId !== previous?.invitationEventId;
  if (invitation && (invitation.roomId !== input.roomId || invitation.senderMatrixId !== acting.value.matrixUserId
    || input.accessMode !== 'reply' || input.powerLevel !== null || input.muted)) return failure('invalid', 'Native invitation does not match the grant intent');
  if (invitation && previous?.invitationEventId === invitation.eventId && previous.accessMode === 'none') return failure('forbidden', 'This invitation was already withdrawn');
  if ((previous?.generation ?? null) !== input.expectedGeneration) return failure('conflict', 'Room membership generation changed');
  let inviterGeneration: string | null = null, inviterRevision: number | null = null;
  if (actor.kind === 'human') {
    const permitted = authorizeAgent(services, actor, input.agentId, 'room-grant.manage');
    if (!permitted.ok) return permitted;
  } else {
    if (input.agentId === actor.principalId) return failure('forbidden', 'An agent cannot grant itself room access');
    const inviter = services.repositories.agentRoomGrant.find({ agentId: actor.principalId, roomId: input.roomId });
    const permission = services.repositories.agentRoomPermission.find({ agentId: actor.principalId, roomId: input.roomId, permissionCode: 'room.agent.invite' });
    if (!inviter.ok) return inviter; if (!permission.ok) return permission;
    if (!inviter.value || inviter.value.accessMode === 'none' || !permission.value || permission.value.generation !== inviter.value.generation) return failure('forbidden', 'This room requires explicit agent invitation permission');
    inviterGeneration = inviter.value.generation; inviterRevision = inviter.value.revision;
    if (previous && previous.accessMode !== 'none' && previous.addedById !== actor.principalId
      && (freshInvitation || input.accessMode === 'none' || !sameGrant(previous, input))) return failure('forbidden', 'An agent can change or remove only its own room additions');
  }
  const changed = freshInvitation || (previous ? !sameGrant(previous, input) : input.accessMode !== 'none');
  const needsNative = input.accessMode !== 'none' && changed
    && (freshInvitation || !previous || previous.accessMode === 'none' || previous.accessMode !== input.accessMode || previous.powerLevel !== input.powerLevel);
  let native: RoomFacts | null = null;
  if (needsNative || actor.kind === 'agent' && input.accessMode !== 'none') {
    const facts = await services.matrix.room(acting.value.matrixUserId, input.roomId);
    if (!facts.ok) return facts;
    if (actor.kind === 'agent' && !facts.value.creator && facts.value.powerLevel < facts.value.inviteLevel) return failure('forbidden', 'The inviter lacks native Matrix invitation authority');
    if (facts.value.creatorIds.includes(target.value.principal.matrixUserId) && input.accessMode !== 'reply') return failure('forbidden', 'A native room creator can have read-and-reply access or no membership; its Matrix authority cannot be restricted');
    const permitted = requestedPower(facts.value, input);
    if (!permitted.ok) return permitted;
    native = facts.value;
  }
  return success({ input, previous, actorRevision: acting.value.revision, targetRevision: target.value.principal.revision,
    ownerRevision: target.value.owner.revision, inviterGeneration, inviterRevision,
    authorizerId: needsNative ? actor.principalId : previous?.authorizerId ?? actor.principalId, native, changed,
    invitationEventId: invitation?.eventId ?? previous?.invitationEventId ?? null,
    admissionKind: invitation ? 'invitation' : needsNative ? 'managed' : previous?.admissionKind ?? 'managed' });
}
