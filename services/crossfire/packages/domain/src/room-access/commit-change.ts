import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
import type { GrantAuthorization } from './authorize-change.js';
import type { AgentRoomGrant } from './types.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock'>;
export function recheckGrantAuthorization(services: Dependencies, actor: Actor, proof: GrantAuthorization): Result<void> {
  const acting = activeActor(services, actor);
  if (!acting.ok) return acting;
  if (acting.value.revision !== proof.actorRevision) return failure('conflict', 'Acting authority changed');
  const target = services.directory.agent(proof.input.agentId);
  if (!target.ok) return target;
  if (!target.value || target.value.principal.revision !== proof.targetRevision || target.value.owner.revision !== proof.ownerRevision) return failure('conflict', 'Target authority changed');
  const current = services.repositories.agentRoomGrant.find({ agentId: proof.input.agentId, roomId: proof.input.roomId });
  if (!current.ok) return current;
  if (current.value?.generation !== proof.previous?.generation || current.value?.revision !== proof.previous?.revision) return failure('conflict', 'Room grant changed');
  if (actor.kind === 'human') {
    const permitted = authorizeAgent(services, actor, proof.input.agentId, 'room-grant.manage');
    if (!permitted.ok) return permitted;
  } else {
    const inviter = services.repositories.agentRoomGrant.find({ agentId: actor.principalId, roomId: proof.input.roomId });
    const permission = services.repositories.agentRoomPermission.find({ agentId: actor.principalId, roomId: proof.input.roomId, permissionCode: 'room.agent.invite' });
    if (!inviter.ok) return inviter; if (!permission.ok) return permission;
    if (!inviter.value || inviter.value.generation !== proof.inviterGeneration || inviter.value.revision !== proof.inviterRevision
      || inviter.value.accessMode === 'none' || !permission.value || permission.value.generation !== proof.inviterGeneration) return failure('conflict', 'Room invitation authority changed');
  }
  return success(undefined);
}

export function commitGrantChange(services: Dependencies, actor: Actor, proof: GrantAuthorization, requestId: string): Result<AgentRoomGrant | null> {
  if (!proof.changed) return success(proof.previous);
  const { input, previous } = proof;
  const newGeneration = !previous || previous.accessMode === 'none' && input.accessMode !== 'none'
    || proof.invitationEventId !== null && proof.invitationEventId !== previous.invitationEventId;
  const generation = newGeneration ? services.identity.id() : previous.generation;
  const accessChanged = !previous || previous.accessMode !== input.accessMode || previous.powerLevel !== input.powerLevel;
  if (newGeneration || input.accessMode === 'none') {
    const permissions = services.collection.roomPermissions({ agentId: input.agentId, roomId: input.roomId });
    if (!permissions.ok) return permissions;
    for (const permission of permissions.value) {
      const removed = services.repositories.agentRoomPermission.remove(permission);
      if (!removed.ok) return removed;
    }
  }
  const grant: AgentRoomGrant = { agentId: input.agentId, roomId: input.roomId, generation, authorizerId: proof.authorizerId,
    addedById: newGeneration ? actor.principalId : previous.addedById, invitationEventId: proof.invitationEventId,
    admissionKind: proof.admissionKind,
    accessMode: input.accessMode, powerLevel: input.powerLevel, muted: input.muted,
    revision: (previous?.revision ?? -1) + 1, accessRevision: (previous?.accessRevision ?? -1) + (accessChanged ? 1 : 0), updatedAt: services.clock.now() };
  const saved = previous ? services.repositories.agentRoomGrant.update(grant) : services.repositories.agentRoomGrant.insert(grant);
  if (!saved.ok) return saved;
  const application = services.repositories.roomGrantApplication.find({ agentId: input.agentId, roomId: input.roomId });
  if (!application.ok) return application;
  const scheduled = application.value
    ? services.repositories.roomGrantApplication.update({ ...application.value, nextCheckAt: services.clock.now() })
    : services.repositories.roomGrantApplication.insert({ agentId: input.agentId, roomId: input.roomId, observedGeneration: null,
      appliedRevision: null, appliedAccessRevision: null, membership: null, creator: false, powerLevel: null, lastAttemptAt: null, lastSuccessAt: null,
      nextCheckAt: services.clock.now(), errorCode: null, errorMessage: null });
  if (!scheduled.ok) return scheduled;
  const target = services.repositories.agent.find({ principalId: input.agentId });
  if (!target.ok) return target;
  const audit = recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: input.agentId, ownerId: target.value?.ownerId ?? null,
    roomId: input.roomId, membershipGeneration: generation, authorizerId: grant.authorizerId, addedById: grant.addedById,
    permissionCode: actor.kind === 'agent' ? 'room.agent.invite' : null, action: input.accessMode === 'none' ? 'room-grant.remove' : 'room-grant.set' });
  return audit.ok ? success(grant) : audit;
}
