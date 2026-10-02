import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { RoomMembership } from '../port/matrix-authority.js';
import { requestedPower } from './authorize-change.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'matrix' | 'clock' | 'unitOfWork' | 'roomOperations'>;

export function reconcileRoomGrant(services: Dependencies, agentId: string, roomId: string): Promise<Result<void>> {
  return services.roomOperations.run(roomId, () => applyRoomGrant(services, agentId, roomId));
}

async function applyRoomGrant(services: Dependencies, agentId: string, roomId: string): Promise<Result<void>> {
  const target = services.directory.agent(agentId);
  const stored = services.repositories.agentRoomGrant.find({ agentId, roomId });
  const application = services.repositories.roomGrantApplication.find({ agentId, roomId });
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!target.ok) return target; if (!stored.ok) return stored; if (!application.ok) return application; if (!policy.ok) return policy;
  if (!target.value || !stored.value || !application.value || !policy.value) return failure('missing', 'Room grant reconciliation state is missing');
  const agent = target.value, grant = stored.value, previous = application.value;
  const conversation = services.repositories.ownerConversation.find({ agentId });
  if (!conversation.ok) return conversation;
  const ownerDirect = conversation.value?.roomId === roomId;
  const authorizer = services.repositories.principal.find({ id: grant.authorizerId });
  if (!authorizer.ok) return authorizer;
  let observed: RoomMembership | null = null;
  function departed(): RoomMembership {
    const identity = { matrixUserId: agent.principal.matrixUserId, displayName: '', membership: 'leave' as const };
    return observed?.creator || previous.creator ? { ...identity, creator: true, powerLevel: null } : { ...identity, creator: false, powerLevel: 0 };
  }
  async function remove(): Promise<Result<void>> {
    const rooms = await services.matrix.joined(agent.principal.matrixUserId);
    if (!rooms.ok) {
      if (agent.principal.status === 'revoked' || agent.owner.status === 'revoked') {
        const account = services.repositories.principalApplication.find({ principalId: agentId });
        if (account.ok && account.value?.appliedStatus === 'revoked') { observed = departed(); return success(undefined); }
      }
      return rooms;
    }
    if (rooms.value.includes(roomId)) {
      const left = await services.matrix.leave(agent.principal.matrixUserId, roomId);
      if (!left.ok) return left;
    } else if (grant.invitationEventId !== null) {
      const invitation = await services.matrix.invitation(agent.principal.matrixUserId, roomId);
      if (!invitation.ok) return invitation;
      if (invitation.value?.eventId === grant.invitationEventId) {
        const left = await services.matrix.leave(agent.principal.matrixUserId, roomId);
        if (!left.ok) return left;
      }
    }
    observed = departed();
    return success(undefined);
  }
  async function apply(): Promise<Result<void>> {
    if (grant.accessMode === 'none' || agent.principal.status !== 'active' || agent.owner.status !== 'active') return remove();
    if (ownerDirect) {
      const verified = await services.matrix.ownerConversation(agent.owner.matrixUserId, agent.principal.matrixUserId, roomId);
      if (!verified.ok) return verified;
      if (verified.value !== roomId) return failure('conflict', 'The owner DM changed during reconciliation');
    }
    if (!authorizer.ok || !authorizer.value || authorizer.value.status !== 'active') {
      const left = await remove();
      return left.ok ? failure('forbidden', 'The grant authorizer is no longer active') : left;
    }
    if (authorizer.value.kind === 'agent') {
      const inviter = services.directory.agent(authorizer.value.id);
      const delegated = services.repositories.agentRoomGrant.find({ agentId: authorizer.value.id, roomId });
      const permission = services.repositories.agentRoomPermission.find({ agentId: authorizer.value.id, roomId, permissionCode: 'room.agent.invite' });
      if (!inviter.ok) return inviter; if (!delegated.ok) return delegated; if (!permission.ok) return permission;
      if (!inviter.value || inviter.value.owner.status !== 'active' || !delegated.value || delegated.value.accessMode === 'none'
        || !permission.value || permission.value.generation !== delegated.value.generation) {
        const left = await remove();
        return left.ok ? failure('forbidden', 'The inviting agent no longer has delegation for this room') : left;
      }
    }
    const facts = await services.matrix.room(authorizer.value.matrixUserId, roomId);
    if (!facts.ok) {
      const left = await remove();
      return left.ok ? facts : left;
    }
    const native = await services.matrix.membership(authorizer.value.matrixUserId, agent.principal.matrixUserId, roomId);
    if (!native.ok) return native;
    observed = native.value;
    const command = ownerDirect || previous.observedGeneration !== grant.generation || previous.appliedAccessRevision !== grant.accessRevision;
    if (!command && native.value.membership !== 'join') { observed = native.value; return success(undefined); }
    const requested = requestedPower(facts.value, grant.accessMode === 'custom' && !facts.value.creator
      ? { ...grant, powerLevel: Math.min(grant.powerLevel!, facts.value.powerLevel) }
      : grant);
    if (!requested.ok) { const left = await remove(); return left.ok ? requested : left; }
    const powerLevel = command || native.value.creator ? requested.value : Math.min(requested.value, native.value.powerLevel);
    const admission = command ? grant.admissionKind === 'managed' ? { kind: 'managed' as const }
      : { kind: 'invitation' as const, eventId: grant.invitationEventId!, senderMatrixId: authorizer.value.matrixUserId } : null;
    const changed = await services.matrix.setRoomAccess(authorizer.value.matrixUserId, agent.principal.matrixUserId, roomId,
      { mode: grant.accessMode, powerLevel }, admission);
    if (!changed.ok) { const left = await remove(); return left.ok ? changed : left; }
    observed = changed.value;
    return success(undefined);
  }
  const result = await apply();
  return services.unitOfWork.run(() => {
    const current = services.repositories.agentRoomGrant.find({ agentId, roomId });
    const identity = services.directory.agent(agentId);
    if (!current.ok) return current; if (!identity.ok) return identity;
    if (!current.value || current.value.generation !== grant.generation || current.value.revision !== grant.revision
      || !identity.value || identity.value.principal.revision !== agent.principal.revision || identity.value.owner.revision !== agent.owner.revision) return failure('conflict', 'Grant authority changed during native application');
    const currentAuthorizer = services.repositories.principal.find({ id: grant.authorizerId });
    if (!currentAuthorizer.ok) return currentAuthorizer;
    if (currentAuthorizer.value?.revision !== authorizer.value?.revision) return failure('conflict', 'Grant authorizer changed during native application');
    return services.repositories.roomGrantApplication.update({ ...previous, lastAttemptAt: services.clock.now(),
      nextCheckAt: services.clock.now() + policy.value!.reconcileSeconds * 1000,
      ...(observed ? { membership: observed.membership, creator: observed.creator, powerLevel: observed.powerLevel } : {}),
      ...(result.ok ? { observedGeneration: grant.generation, appliedRevision: grant.revision, appliedAccessRevision: grant.accessRevision,
        lastSuccessAt: services.clock.now(), errorCode: null, errorMessage: null } : { errorCode: result.error.code, errorMessage: result.error.message }) });
  });
}
