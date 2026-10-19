import type { Services } from '../port/services.js';
import type { Principal, PrincipalApplication } from '../identity/types.js';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { success } from '@ctlflow/crossfire-kernel/result';

export function pendingApplication(principalId: string, now: number): PrincipalApplication {
  return { principalId, appliedRevision: null, appliedIntentHash: null, appliedStatus: null, nativeDisplayName: null,
    lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: now, errorCode: null, errorMessage: null };
}
export function registerPrincipal(services: Pick<Services, 'repositories' | 'clock'>,
  principal: Principal, roleCode: 'member' | 'administrator' | 'agent', assignedByMemberId: string | null): Result<void> {
  const created = services.repositories.principal.insert(principal);
  if (!created.ok) return created;
  const application = services.repositories.principalApplication.insert(pendingApplication(principal.id, services.clock.now()));
  if (!application.ok) return application;
  return services.repositories.principalRole.insert({ principalId: principal.id, principalKind: principal.kind,
    roleCode, assignedByMemberId, assignedAt: services.clock.now() });
}
export function initializeInstance(services: Pick<Services, 'repositories' | 'directory' | 'identity' | 'clock' | 'unitOfWork' | 'messaging'>, administratorBackendUserId: string): Result<void> {
  return services.unitOfWork.run(() => {
    const policy = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!policy.ok) return policy;
    if (!policy.value) {
      const added = services.repositories.instancePolicy.insert({ id: 'instance', revision: 0, maxOwnerAgents: 10, maxAgents: 100,
        maxPending: 100, enrollmentSeconds: 600, reconcileSeconds: 300, maxMessageBytes: 65536, fleetIdleTimeoutSeconds: 1800, agentInstructions: '', signupMode: 'invitation', invitationIssuers: 'administrators' });
      if (!added.ok) return added;
    }
    const existing = services.directory.principalByBackendUserId(administratorBackendUserId);
    if (!existing.ok) return existing;
    if (existing.value) return success(undefined);
    const id = services.identity.id();
    const registered = registerPrincipal(services, { id, backendUserId: administratorBackendUserId, kind: 'human', status: 'active', revision: 0, createdAt: services.clock.now() }, 'administrator', null);
    if (!registered.ok) return registered;
    return services.repositories.member.insert({ principalId: id, principalKind: 'human',
      displayName: services.messaging.localLabel(administratorBackendUserId) });
  });
}
