import { failure, success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import { registerPrincipal } from '../principal/register.js';
import { recordEvent } from '../audit/record-event.js';
import { expireEnrollments } from './expire.js';

export function decideEnrollment(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock' | 'instance'>,
  actor: Actor, enrollmentId: string, input: { expectedRevision: number; decision: 'approve' | 'reject'; verificationCode: string }, requestId: string) {
  return services.unitOfWork.run(() => {
    const expired = expireEnrollments(services);
    if (!expired.ok) return expired;
    const found = services.repositories.enrollmentRequest.find({ id: enrollmentId });
    if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Enrollment not found');
    const request = found.value;
    const authority = authorize(services, actor, input.decision === 'approve' ? 'enrollment.approve.owned'
      : request.ownerId === actor.principalId ? 'enrollment.reject.owned' : 'enrollment.reject.any');
    if (!authority.ok) return authority;
    if (input.decision === 'approve' && actor.principalId !== request.ownerId) return failure('forbidden', 'Only the intended human owner may approve enrollment');
    if (request.status !== 'pending' || request.revision !== input.expectedRevision || request.verificationCode !== input.verificationCode) return failure('conflict', 'Enrollment or verification code changed');
    const owner = services.repositories.principal.find({ id: request.ownerId });
    if (!owner.ok) return owner;
    if (!owner.value || owner.value.status !== 'active') return failure('forbidden', 'Owner must be active');
    const items = services.collection.enrollmentItems({ requestId: enrollmentId });
    if (!items.ok) return items;
    const now = services.clock.now();
    if (input.decision === 'approve') {
      const policy = services.repositories.instancePolicy.find({ id: 'instance' });
      const active = services.directory.activeAgentCount(), owned = services.directory.activeAgentCount(request.ownerId);
      const pending = services.collection.pendingIdentityCount(), ownedPending = services.collection.pendingIdentityCount(request.ownerId);
      if (!policy.ok) return policy; if (!active.ok) return active; if (!owned.ok) return owned; if (!pending.ok) return pending; if (!ownedPending.ok) return ownedPending;
      if (!policy.value || active.value + pending.value > policy.value.maxAgents || owned.value + ownedPending.value > policy.value.maxOwnerAgents) return failure('limit', 'Agent capacity changed; adjust the instance limits');
      if (request.fleetKey !== null) {
        const fleet = services.repositories.fleet.find({ ownerId: request.ownerId, fleetKey: request.fleetKey });
        if (!fleet.ok) return fleet;
        if (!fleet.value) { const saved = services.repositories.fleet.insert({ ownerId: request.ownerId, fleetKey: request.fleetKey, createdAt: now }); if (!saved.ok) return saved; }
      }
      for (const item of items.value) {
        if (item.outcome === 'failed') continue;
        let agentId = item.agentId;
        if (item.outcome === 'claimed') {
          const name = services.repositories.agentName.find({ name: item.requestedName });
          if (!name.ok) return name;
          if (!name.value || name.value.requestId !== request.id || name.value.instanceKey !== item.instanceKey) return failure('conflict', 'Name collision: ' + item.requestedName);
          agentId = services.identity.id();
          const principal = registerPrincipal(services, { id: agentId, matrixUserId: '@agent-' + agentId + ':' + services.instance.serverName,
            kind: 'agent', status: 'active', revision: 0, createdAt: now }, 'agent', request.ownerId);
          if (!principal.ok) return principal;
          const agent = services.repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId: request.ownerId, displayNameOverride: null, wakeMode: 'owner' });
          if (!agent.ok) return agent;
          const credentials = services.repositories.agentCredential.insert({ agentId, provisioningPassword: services.identity.secret(), accessToken: null, updatedAt: now });
          if (!credentials.ok) return credentials;
          const claimed = services.repositories.agentName.update({ name: item.requestedName, requestId: null, instanceKey: null, agentId });
          if (!claimed.ok) return claimed;
          const assigned = services.repositories.enrollmentItem.update({ ...item, agentId });
          if (!assigned.ok) return assigned;
        }
        if (request.fleetKey !== null && agentId !== null) {
          const binding = services.repositories.fleetInstance.find({ ownerId: request.ownerId, fleetKey: request.fleetKey, instanceKey: item.instanceKey });
          if (!binding.ok) return binding;
          if (binding.value && binding.value.agentId !== agentId) return failure('conflict', 'Fleet instance identity changed: ' + item.instanceKey);
          if (!binding.value) { const bound = services.repositories.fleetInstance.insert({ ownerId: request.ownerId, fleetKey: request.fleetKey, instanceKey: item.instanceKey, agentId }); if (!bound.ok) return bound; }
        }
      }
    } else {
      const names = services.collection.agentNamesByRequest({ requestId: enrollmentId });
      if (!names.ok) return names;
      for (const name of names.value) { const removed = services.repositories.agentName.remove({ name: name.name }); if (!removed.ok) return removed; }
    }
    const decision = services.repositories.enrollmentRequest.update({ ...request, status: input.decision === 'approve' ? 'approved' : 'rejected',
      revision: request.revision + 1, decidedByMemberId: actor.principalId, decidedAt: now });
    if (!decision.ok) return decision;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'enrollment', targetId: enrollmentId, ownerId: request.ownerId, action: 'enrollment.' + input.decision });
    return audit.ok ? success({ enrollmentId, status: input.decision === 'approve' ? 'approved' : 'rejected', revision: request.revision + 1 }) : audit;
  });
}
