import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import type { Principal } from '../identity/types.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'identity' | 'clock' | 'unitOfWork'>;
export async function reconcilePrincipal(services: Dependencies, principalId: string): Promise<Result<void>> {
  const found = services.repositories.principal.find({ id: principalId });
  const application = services.repositories.principalApplication.find({ principalId });
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!found.ok) return found; if (!application.ok) return application; if (!policy.ok) return policy;
  if (!found.value || !application.value || !policy.value) return failure('missing', 'Principal reconciliation state is missing');
  const principal = found.value;
  const nextCheckAt = services.clock.now() + policy.value.reconcileSeconds * 1000;
  let status: Principal['status'] = principal.status;
  let displayName = principal.matrixUserId;
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
    displayName = agent.value.agent.displayNameOverride ?? agent.value.name + ' (' + agent.value.ownerMember.displayName + ')';
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
  const intentHash = services.identity.hash(JSON.stringify({ matrixUserId: principal.matrixUserId, status, displayName }));
  async function apply(): Promise<Result<void>> {
    if (status === 'revoked') {
      const present = await services.matrix.exists(principal.matrixUserId);
      if (!present.ok) return present;
      token = null;
      return present.value ? services.matrix.deactivate(principal.matrixUserId) : success(undefined);
    }
    if (principal.kind === 'agent') {
      const credentials = services.repositories.agentCredential.find({ agentId: principal.id });
      if (!credentials.ok) return credentials;
      if (!credentials.value) return failure('missing', 'Agent credentials are missing');
      const valid = token ? await services.matrix.identify(token) : null;
      if (!valid?.ok || valid.value !== principal.matrixUserId) {
        const created = await services.matrix.provision(principal.matrixUserId, credentials.value.provisioningPassword, 'CROSSFIRE_AGENT');
        if (!created.ok) return created;
        token = created.value.accessToken;
      }
    }
    const rooms = await services.matrix.joined(principal.matrixUserId);
    if (!rooms.ok) return rooms;
    const permitted = principal.kind === 'agent' ? services.collection.roomGrants({ agentId: principal.id }) : success([]);
    if (!permitted.ok) return permitted;
    for (const roomId of rooms.value) {
      if (status !== 'active' || principal.kind === 'agent' && !permitted.value.some(grant => grant.roomId === roomId && grant.accessMode !== 'none')) {
        const left = await services.matrix.leave(principal.matrixUserId, roomId);
        if (!left.ok) return left;
      }
    }
    if (application.ok && application.value?.appliedIntentHash !== intentHash) return services.matrix.setDisplayName(principal.matrixUserId, displayName);
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
