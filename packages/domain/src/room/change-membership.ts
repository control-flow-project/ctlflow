import { failure } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import { changeRoomGrant } from '../room-access/change-grant.js';
import { recordEvent } from '../audit/record-event.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'unitOfWork' | 'identity' | 'clock'>;
export async function changeMembership(services: Dependencies, actor: Actor, roomId: string,
  input: { targetId: string; action: 'invite' | 'kick'; expectedRevision?: number; expectedGeneration?: string | null }, requestId: string) {
  const current = authorize(services, actor, 'room.manage.native');
  if (!current.ok) return current;
  const target = services.repositories.principal.find({ id: input.targetId });
  if (!target.ok) return target;
  if (!target.value) return failure('missing', 'Membership target not found');
  if (target.value.kind === 'agent') {
    if (input.expectedRevision === undefined || input.expectedGeneration === undefined) return failure('invalid', 'Agent membership requires its revision and expected generation');
    return changeRoomGrant(services, actor, { agentId: target.value.id, roomId, expectedRevision: input.expectedRevision,
      expectedGeneration: input.expectedGeneration, accessMode: input.action === 'invite' ? 'reply' : 'none', powerLevel: null, muted: false }, requestId);
  }
  if (input.expectedRevision !== undefined || input.expectedGeneration !== undefined) return failure('invalid', 'Human membership has native Matrix preconditions');
  if (target.value.status !== 'active' && input.action === 'invite') return failure('forbidden', 'Target member must be active');
  const native = await services.matrix.changeMembership(current.value.matrixUserId, roomId, target.value.matrixUserId, input.action);
  if (!native.ok) return native;
  return recordEvent(services, actor, requestId, { targetKind: 'member', targetId: target.value.id, roomId, action: 'room.member.' + input.action });
}
