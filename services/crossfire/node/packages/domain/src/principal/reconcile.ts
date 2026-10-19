import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { Principal } from '../identity/types.js';
import { agentDisplayName } from '../identity/display-name.js';
import { reconcileRoomGrant } from '../room-access/reconcile-grant.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'messaging' | 'identity' | 'clock' | 'unitOfWork' | 'roomOperations' | 'runtime'>;
export async function reconcilePrincipal(services: Dependencies, principalId: string): Promise<Result<void>> {
  const applied = await services.roomOperations.run('agent:' + principalId, () => applyPrincipal(services, principalId));
  if (!applied.ok) return applied;
  const principal = services.repositories.principal.find({ id: principalId });
  if (!principal.ok) return principal;
  if (principal.value?.kind !== 'agent' || principal.value.status !== 'active') return applied;
  const target = services.directory.agent(principalId);
  if (!target.ok) return target;
  if (target.value?.owner.status !== 'active') return applied;
  const bound = services.repositories.ownerConversation.find({ agentId: principalId });
  if (!bound.ok) return bound;
  if (!bound.value) return applied;
  return reconcileRoomGrant(services, principalId, bound.value.roomId);
}

async function applyPrincipal(services: Dependencies, principalId: string): Promise<Result<void>> {
  const found = services.repositories.principal.find({ id: principalId });
  const application = services.repositories.principalApplication.find({ principalId });
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!found.ok) return found; if (!application.ok) return application; if (!policy.ok) return policy;
  if (!found.value || !application.value || !policy.value) return failure('missing', 'Principal reconciliation state is missing');
  const principal = found.value;
  const nextCheckAt = services.clock.now() + policy.value.reconcileSeconds * 1000;
  let status: Principal['status'] = principal.status;
  let displayName = principal.backendUserId;
  let ownerRevision: number | null = null;
  let ownerId: string | null = null;
  let token: string | null = null;
  if (principal.kind === 'agent') {
    const agent = services.directory.agent(principal.id);
    if (!agent.ok) return agent;
    if (!agent.value) return failure('missing', 'Agent not found');
    ownerRevision = agent.value.owner.revision; ownerId = agent.value.owner.id;
    if (agent.value.owner.status === 'revoked') status = 'revoked';
    else if (agent.value.owner.status !== 'active' && status === 'active') status = 'suspended';
    displayName = agentDisplayName(agent.value.name, agent.value.ownerMember.displayName);
    const credentials = services.repositories.agentCredential.find({ agentId: principal.id });
    if (!credentials.ok) return credentials;
    if (!credentials.value) return failure('missing', 'Agent credentials are missing');
    token = credentials.value.accessToken;
  } else {
    const member = services.repositories.member.find({ principalId });
    if (!member.ok) return member;
    if (!member.value) return failure('missing', 'Member not found');
    displayName = member.value.displayName;
  }
  const intentHash = services.identity.hash(JSON.stringify({ backendUserId: principal.backendUserId, status, displayName }));
  async function apply(): Promise<Result<void>> {
    if (status === 'revoked') {
      const present = await services.messaging.exists(principal.backendUserId);
      if (!present.ok) return present;
      token = null;
      return present.value ? services.messaging.deactivate(principal.backendUserId) : success(undefined);
    }
    if (principal.kind === 'agent') {
      const credentials = services.repositories.agentCredential.find({ agentId: principal.id });
      if (!credentials.ok) return credentials;
      if (!credentials.value) return failure('missing', 'Agent credentials are missing');
      const valid = token ? await services.messaging.identify(token) : null;
      if (!valid?.ok || valid.value !== principal.backendUserId) {
        const created = await services.messaging.provision(principal.backendUserId, credentials.value.provisioningPassword);
        if (!created.ok) return created;
        token = created.value.accessToken;
      }
    }
    const rooms = await services.messaging.joined(principal.backendUserId);
    if (!rooms.ok) return rooms;
    const permitted = principal.kind === 'agent' ? services.collection.roomGrants({ agentId: principal.id }) : success([]);
    if (!permitted.ok) return permitted;
    for (const roomId of rooms.value) {
      if (status !== 'active' || principal.kind === 'agent' && !permitted.value.some(grant => grant.roomId === roomId && grant.accessMode !== 'none')) {
        const left = await services.messaging.leave(principal.backendUserId, roomId);
        if (!left.ok) return left;
      }
    }
    if (application.ok && application.value?.appliedIntentHash !== intentHash) {
      const named = await services.messaging.setDisplayName(principal.backendUserId, displayName);
      if (!named.ok) return named;
      if (principal.kind === 'agent' && ownerId !== null && application.value?.nativeDisplayName !== displayName) {
        const conversation = services.repositories.ownerConversation.find({ agentId: principalId });
        if (!conversation.ok) return conversation;
        if (conversation.value) {
          const owner = services.repositories.principal.find({ id: ownerId });
          if (!owner.ok) return owner;
          if (!owner.value) return failure('missing', 'Owner no longer exists');
          const updated = await services.messaging.ownerConversation(owner.value.backendUserId, principal.backendUserId,
            conversation.value.roomId, application.value?.nativeDisplayName ?? null);
          if (!updated.ok) return updated;
          if (updated.value !== conversation.value.roomId) return failure('conflict', 'Owner conversation changed during renaming');
        }
      }
    }
    return success(undefined);
  }
  const result = await apply();
  return services.unitOfWork.run(() => {
    const current = services.repositories.principal.find({ id: principal.id });
    if (!current.ok) return current;
    if (!current.value || current.value.revision !== principal.revision) return failure('conflict', 'Principal changed during native application');
    if (ownerId !== null) {
      const owner = services.repositories.principal.find({ id: ownerId });
      if (!owner.ok) return owner;
      if (!owner.value || owner.value.revision !== ownerRevision) return failure('conflict', 'Owner changed during native application');
    }
    if (principal.kind === 'agent' && result.ok) {
      const credentials = services.repositories.agentCredential.find({ agentId: principalId });
      if (!credentials.ok) return credentials;
      if (!credentials.value) return failure('missing', 'Agent credentials are missing');
      const saved = services.repositories.agentCredential.update({ ...credentials.value, accessToken: token, updatedAt: services.clock.now() });
      if (!saved.ok) return saved;
    }
    const saved = services.repositories.principalApplication.update({ ...application.value!, lastAttemptAt: services.clock.now(), nextCheckAt,
      ...(result.ok ? { appliedRevision: principal.revision, appliedIntentHash: intentHash, appliedStatus: status, nativeDisplayName: displayName,
        lastSuccessAt: services.clock.now(), errorCode: null, errorMessage: null } : { errorCode: result.error.code, errorMessage: result.error.message }) });
    return saved.ok ? success(undefined) : saved;
  });
}
