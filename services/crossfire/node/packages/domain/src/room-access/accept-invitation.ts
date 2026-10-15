import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import { changeRoomGrant } from './change-grant.js';
import { reconcileRoomGrant } from './reconcile-grant.js';
import { ensureOwnerConversation } from '../owner-conversation/ensure.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork' | 'roomOperations' | 'runtime'>;

export async function acceptRoomInvitation(services: Dependencies, receiver: Actor, agentId: string, roomId: string, requestId: string) {
  const permitted = authorize(services, receiver, 'room-invitation.accept.self');
  if (!permitted.ok) return permitted;
  if (receiver.kind !== 'agent' || receiver.principalId !== agentId) return failure('forbidden', 'Only the invited agent may accept its invitation');
  const target = services.directory.agent(agentId);
  if (!target.ok) return target;
  if (!target.value) return failure('missing', 'Invited agent not found');
  const invitation = await services.matrix.invitation(target.value.principal.matrixUserId, roomId);
  if (!invitation.ok) return invitation;
  if (!invitation.value) return success({ accepted: false });
  const bound = services.repositories.ownerConversation.find({ agentId });
  if (!bound.ok) return bound;
  if (invitation.value.direct && invitation.value.senderMatrixId === target.value.owner.matrixUserId
    && (!bound.value || bound.value.roomId === roomId)) {
    const conversation = await ensureOwnerConversation(services, agentId, invitation.value);
    return conversation.ok ? success({ accepted: true }) : conversation;
  }
  const sender = services.directory.principalByMatrixId(invitation.value.senderMatrixId);
  if (!sender.ok) return sender;
  if (!sender.value) return failure('forbidden', 'The inviter is not a registered Crossfire identity');
  const grant = services.repositories.agentRoomGrant.find({ agentId, roomId });
  if (!grant.ok) return grant;
  if (grant.value?.invitationEventId === invitation.value.eventId) {
    if (grant.value.accessMode === 'none') return failure('forbidden', 'This invitation was already withdrawn');
  } else {
    const inviter: Actor = { principalId: sender.value.id, kind: sender.value.kind,
      authentication: { kind: 'native', matrixUserId: invitation.value.senderMatrixId } };
    const changed = await changeRoomGrant(services, inviter, { agentId, roomId, expectedRevision: target.value.principal.revision,
      expectedGeneration: grant.value?.generation ?? null, accessMode: 'reply', powerLevel: null, muted: false }, requestId, invitation.value);
    if (!changed.ok) return changed;
  }
  const applied = await reconcileRoomGrant(services, agentId, roomId);
  if (!applied.ok) return applied;
  const observation = services.repositories.roomGrantApplication.find({ agentId, roomId });
  if (!observation.ok) return observation;
  if (observation.value?.errorCode) return failure(observation.value.errorCode === 'conflict' ? 'conflict'
    : observation.value.errorCode === 'forbidden' ? 'forbidden' : 'native', observation.value.errorMessage ?? 'Native invitation remains pending');
  const accepted = observation.value?.membership === 'join';
  if (accepted && invitation.value.direct) {
    const marked = await services.matrix.markDirect(target.value.principal.matrixUserId, invitation.value.senderMatrixId, roomId);
    if (!marked.ok) return marked;
  }
  return success({ accepted });
}
