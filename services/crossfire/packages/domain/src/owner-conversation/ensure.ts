import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import { authorizeGrantChange } from '../room-access/authorize-change.js';
import { commitGrantChange, recheckGrantAuthorization } from '../room-access/commit-change.js';
import { reconcileRoomGrant } from '../room-access/reconcile-grant.js';
import { recordEvent } from '../audit/record-event.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork' | 'roomOperations'>;

export function ensureOwnerConversation(services: Dependencies, agentId: string) {
  return services.roomOperations.run('agent:' + agentId, async () => {
    const target = services.directory.agent(agentId), previous = services.repositories.ownerConversation.find({ agentId });
    if (!target.ok) return target; if (!previous.ok) return previous;
    if (!target.value) return failure('missing', 'Agent not found');
    const identity = target.value;
    if (identity.principal.status !== 'active' || identity.owner.status !== 'active') return failure('forbidden', 'Agent and owner must be active');
    if (identity.application.appliedStatus !== 'active' || identity.application.errorCode !== null) return failure('unavailable', 'The native agent account is not ready');
    const native = await services.matrix.ownerConversation(identity.owner.matrixUserId, identity.principal.matrixUserId, previous.value?.roomId ?? null);
    if (!native.ok) return native;
    if (previous.value && (previous.value.ownerId !== identity.owner.id || previous.value.roomId !== native.value)) return failure('conflict', 'The native owner conversation changed');
    const grant = services.repositories.agentRoomGrant.find({ agentId, roomId: native.value });
    if (!grant.ok) return grant;
    const actor = { principalId: identity.owner.id, kind: 'human' as const,
      authentication: { kind: 'native' as const, matrixUserId: identity.owner.matrixUserId } };
    const proof = await authorizeGrantChange(services, actor, { agentId, roomId: native.value,
      expectedRevision: identity.principal.revision, expectedGeneration: grant.value?.generation ?? null,
      accessMode: 'reply', powerLevel: null, muted: false });
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
      const permissions = services.collection.roomPermissions({ agentId, roomId: native.value });
      if (!permissions.ok) return permissions;
      for (const permission of permissions.value) {
        const removed = services.repositories.agentRoomPermission.remove(permission);
        if (!removed.ok) return removed;
      }
      if (permissions.value.length) {
        const changed = services.repositories.agentRoomGrant.update({ ...committed.value, revision: committed.value.revision + 1, updatedAt: services.clock.now() });
        if (!changed.ok) return changed;
        const audited = recordEvent(services, actor, services.identity.id(), { targetKind: 'agent', targetId: agentId,
          ownerId: identity.owner.id, roomId: native.value, action: 'owner-conversation.ensure' });
        if (!audited.ok) return audited;
      }
      if (proof.value.changed || permissions.value.length) {
        const revised = services.repositories.principal.update({ ...identity.principal, revision: identity.principal.revision + 1 });
        if (!revised.ok) return revised;
      }
      return bound.value ? success(undefined) : services.repositories.ownerConversation.insert({ agentId, ownerId: identity.owner.id,
        roomId: native.value, createdAt: services.clock.now() });
    });
    if (!saved.ok) return saved;
    const applied = await reconcileRoomGrant(services, agentId, native.value);
    if (!applied.ok) return applied;
    const observation = services.repositories.roomGrantApplication.find({ agentId, roomId: native.value });
    if (!observation.ok) return observation;
    if (observation.value?.membership !== 'join' || observation.value.errorCode !== null) return failure('unavailable', observation.value?.errorMessage ?? 'Owner conversation read and reply is not ready');
    return success({ roomId: native.value });
  });
}
