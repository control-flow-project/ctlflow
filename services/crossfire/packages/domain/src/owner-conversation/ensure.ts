import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import { authorizeGrantChange } from '../room-access/authorize-change.js';
import { commitGrantChange, recheckGrantAuthorization } from '../room-access/commit-change.js';
import { reconcileRoomGrant } from '../room-access/reconcile-grant.js';
import { recordEvent } from '../audit/record-event.js';
import type { RoomInvitation } from '../port/matrix-authority.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork' | 'roomOperations'>;

export function ensureOwnerConversation(services: Dependencies, agentId: string, invitation: RoomInvitation | null = null) {
  return services.roomOperations.run('agent:' + agentId, async () => {
    const target = services.directory.agent(agentId), previous = services.repositories.ownerConversation.find({ agentId });
    if (!target.ok) return target; if (!previous.ok) return previous;
    if (!target.value) return failure('missing', 'Agent not found');
    const identity = target.value;
    if (identity.principal.status !== 'active' || identity.owner.status !== 'active') return failure('forbidden', 'Agent and owner must be active');
    if (identity.application.appliedStatus !== 'active' || identity.application.errorCode !== null) return failure('unavailable', 'The native agent account is not ready');
    if (invitation && (!invitation.direct || invitation.senderMatrixId !== identity.owner.matrixUserId
      || previous.value && previous.value.roomId !== invitation.roomId)) return failure('conflict', 'The invitation does not identify this agent’s private owner conversation');
    if (invitation) {
      const current = await services.matrix.invitation(identity.principal.matrixUserId, invitation.roomId);
      if (!current.ok) return current;
      if (!current.value || !current.value.direct || current.value.eventId !== invitation.eventId
        || current.value.senderMatrixId !== invitation.senderMatrixId) return failure('conflict', 'The owner DM invitation was withdrawn or replaced');
    }
    let roomId: string;
    if (invitation) {
      const verified = await services.matrix.verifyOwnerConversation(identity.owner.matrixUserId, identity.principal.matrixUserId, invitation.roomId);
      if (!verified.ok) return verified;
      roomId = invitation.roomId;
    } else {
      const native = await services.matrix.ownerConversation(identity.owner.matrixUserId, identity.principal.matrixUserId, previous.value?.roomId ?? null);
      if (!native.ok) return native;
      roomId = native.value;
    }
    if (previous.value && (previous.value.ownerId !== identity.owner.id || previous.value.roomId !== roomId)) return failure('conflict', 'The native owner conversation changed');
    const grant = services.repositories.agentRoomGrant.find({ agentId, roomId });
    if (!grant.ok) return grant;
    const actor = { principalId: identity.owner.id, kind: 'human' as const,
      authentication: { kind: 'native' as const, matrixUserId: identity.owner.matrixUserId } };
    const proof = await authorizeGrantChange(services, actor, { agentId, roomId,
      expectedRevision: identity.principal.revision, expectedGeneration: grant.value?.generation ?? null,
      accessMode: 'reply', powerLevel: null, muted: false }, invitation);
    if (!proof.ok) return proof;
    const saved = services.unitOfWork.run(() => {
      const rechecked = recheckGrantAuthorization(services, actor, proof.value);
      if (!rechecked.ok) return rechecked;
      const bound = services.repositories.ownerConversation.find({ agentId });
      if (!bound.ok) return bound;
      if (bound.value?.roomId !== previous.value?.roomId) return failure('conflict', 'Owner conversation changed during native application');
      const committed = commitGrantChange(services, actor, proof.value, services.identity.id());
      if (!committed.ok) return committed;
      if (!committed.value || committed.value.authorizerId !== identity.owner.id || committed.value.addedById !== identity.owner.id) return failure('forbidden', 'Owner conversation provenance does not match');
      let committedGrant = committed.value;
      const permissions = services.collection.roomPermissions({ agentId, roomId });
      if (!permissions.ok) return permissions;
      for (const permission of permissions.value) {
        const removed = services.repositories.agentRoomPermission.remove(permission);
        if (!removed.ok) return removed;
      }
      if (permissions.value.length) {
        committedGrant = { ...committedGrant, revision: committedGrant.revision + 1, updatedAt: services.clock.now() };
        const changed = services.repositories.agentRoomGrant.update(committedGrant);
        if (!changed.ok) return changed;
        const audited = recordEvent(services, actor, services.identity.id(), { targetKind: 'agent', targetId: agentId,
          ownerId: identity.owner.id, roomId, action: 'owner-conversation.ensure' });
        if (!audited.ok) return audited;
      }
      if (proof.value.changed || permissions.value.length) {
        const revised = services.repositories.principal.update({ ...identity.principal, revision: identity.principal.revision + 1 });
        if (!revised.ok) return revised;
      }
      return success({ grant: committedGrant, revision: identity.principal.revision + (proof.value.changed || permissions.value.length ? 1 : 0) });
    });
    if (!saved.ok) return saved;
    const applied = await reconcileRoomGrant(services, agentId, roomId);
    if (!applied.ok) return applied;
    const observation = services.repositories.roomGrantApplication.find({ agentId, roomId });
    if (!observation.ok) return observation;
    if (observation.value?.membership !== 'join' || observation.value.errorCode !== null) return failure('unavailable', observation.value?.errorMessage ?? 'Owner conversation read and reply is not ready');
    const marked = await services.matrix.ownerConversation(identity.owner.matrixUserId, identity.principal.matrixUserId, roomId);
    if (!marked.ok) return marked;
    if (marked.value !== roomId) return failure('conflict', 'The native owner conversation changed');
    const bound = services.unitOfWork.run(() => {
      const current = services.directory.agent(agentId), existing = services.repositories.ownerConversation.find({ agentId });
      const currentGrant = services.repositories.agentRoomGrant.find({ agentId, roomId });
      if (!current.ok) return current; if (!existing.ok) return existing; if (!currentGrant.ok) return currentGrant;
      if (!current.value || current.value.principal.revision !== saved.value.revision || current.value.owner.revision !== identity.owner.revision
        || currentGrant.value?.generation !== saved.value.grant.generation || currentGrant.value.revision !== saved.value.grant.revision
        || existing.value?.roomId !== previous.value?.roomId) return failure('conflict', 'Owner conversation authority changed during native application');
      return existing.value ? success(undefined) : services.repositories.ownerConversation.insert({ agentId, ownerId: identity.owner.id,
        roomId, createdAt: services.clock.now() });
    });
    return bound.ok ? success({ roomId }) : bound;
  });
}
