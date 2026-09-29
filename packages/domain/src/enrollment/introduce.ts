import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { Services } from '../port/services.js';
import type { EnrollmentIntroduction } from './input.js';
import { verifyRoster } from './preflight.js';
import { expireEnrollments } from './expire.js';
import type { EnrollmentRequest, EnrollmentItem } from './types.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'unitOfWork' | 'identity' | 'clock'>;
export type EnrollmentReceipt = { request: EnrollmentRequest; instances: EnrollmentItem[] };
export async function introduceEnrollment(services: Dependencies, input: EnrollmentIntroduction): Promise<Result<EnrollmentReceipt>> {
  if (!/^[a-f0-9-]{36}$/u.test(input.enrollmentId) || !/^[A-Za-z0-9_-]{43}$/u.test(input.claimSecret)) return failure('invalid', 'Persist a request UUID and private 32-byte claim before enrollment');
  const verified = await verifyRoster(services, input);
  if (!verified.ok) return verified;
  const rosterDigest = services.identity.hash(JSON.stringify({ owner: input.ownerMatrixId, fleet: input.fleetKey,
    items: input.instances.map(item => [item.instanceKey, item.name, item.identity?.agentId ?? null]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) }));
  return services.unitOfWork.run(() => {
    const expired = expireEnrollments(services);
    if (!expired.ok) return expired;
    const previous = services.repositories.enrollmentRequest.find({ id: input.enrollmentId });
    if (!previous.ok) return previous;
    if (previous.value) {
      if (previous.value.rosterDigest !== rosterDigest || !services.identity.matches(input.claimSecret, previous.value.claimHash)) return failure('conflict', 'Enrollment request belongs to different credentials or roster');
      const items = services.collection.enrollmentItems({ requestId: input.enrollmentId });
      return items.ok ? success({ request: previous.value, instances: items.value }) : items;
    }
    const owner = services.repositories.principal.find({ id: verified.value.ownerId });
    if (!owner.ok) return owner;
    if (!owner.value || owner.value.revision !== verified.value.ownerRevision || owner.value.status !== 'active') return failure('conflict', 'Owner authority changed');
    for (const item of verified.value.existing) {
      const principal = services.repositories.principal.find({ id: item.agentId });
      if (!principal.ok) return principal;
      if (!principal.value || principal.value.status !== 'active' || principal.value.revision !== item.revision) return failure('conflict', 'Existing agent authority changed');
    }
    const policy = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!policy.ok) return policy;
    if (!policy.value) return failure('unavailable', 'Instance is not initialized');
    const pendingRequests = services.collection.pendingEnrollmentCount();
    if (!pendingRequests.ok) return pendingRequests;
    if (pendingRequests.value >= policy.value.maxPending) return failure('limit', 'Pending enrollment capacity reached');
    const active = services.directory.activeAgentCount(), owned = services.directory.activeAgentCount(owner.value.id);
    const pending = services.collection.pendingIdentityCount(), ownedPending = services.collection.pendingIdentityCount(owner.value.id);
    if (!active.ok) return active; if (!owned.ok) return owned; if (!pending.ok) return pending; if (!ownedPending.ok) return ownedPending;
    let remaining = Math.min(policy.value.maxAgents - active.value - pending.value, policy.value.maxOwnerAgents - owned.value - ownedPending.value);
    const now = services.clock.now();
    const request: EnrollmentRequest = { id: input.enrollmentId, ownerId: owner.value.id, fleetKey: input.fleetKey,
      verificationCode: services.identity.verificationCode(), claimHash: services.identity.hash(input.claimSecret), rosterDigest,
      status: 'pending', revision: 0, createdAt: now, expiresAt: now + policy.value.enrollmentSeconds * 1000, decidedByMemberId: null, decidedAt: null };
    const saved = services.repositories.enrollmentRequest.insert(request);
    if (!saved.ok) return saved;
    const instances: EnrollmentItem[] = [];
    for (const item of input.instances) {
      const existing = verified.value.existing.find(proof => proof.instanceKey === item.instanceKey);
      const claim = services.repositories.agentName.find({ name: item.name });
      if (!claim.ok) return claim;
      const failureCode = !existing && claim.value ? 'name_collision' : !existing && remaining <= 0 ? 'capacity' : null;
      const record: EnrollmentItem = { requestId: request.id, instanceKey: item.instanceKey, requestedName: item.name,
        outcome: existing ? 'existing' : failureCode ? 'failed' : 'claimed', agentId: existing?.agentId ?? null, failureCode };
      const added = services.repositories.enrollmentItem.insert(record);
      if (!added.ok) return added;
      if (record.outcome === 'claimed') {
        const claimed = services.repositories.agentName.insert({ name: item.name, requestId: request.id, instanceKey: item.instanceKey, agentId: null });
        if (!claimed.ok) return claimed;
        remaining--;
      }
      instances.push(record);
    }
    if (!instances.some(item => item.outcome === 'claimed')) {
      if (input.fleetKey !== null && verified.value.existing.length > 0) {
        const fleetKey = input.fleetKey;
        const fleet = services.repositories.fleet.find({ ownerId: owner.value.id, fleetKey });
        if (!fleet.ok) return fleet;
        if (!fleet.value) {
          const created = services.repositories.fleet.insert({ ownerId: owner.value.id, fleetKey, createdAt: now });
          if (!created.ok) return created;
        }
        for (const proof of verified.value.existing) {
          const key = { ownerId: owner.value.id, fleetKey, instanceKey: proof.instanceKey };
          const binding = services.repositories.fleetInstance.find(key);
          if (!binding.ok) return binding;
          if (binding.value && binding.value.agentId !== proof.agentId) return failure('conflict', 'Fleet identity changed');
          if (!binding.value) { const bound = services.repositories.fleetInstance.insert({ ...key, agentId: proof.agentId }); if (!bound.ok) return bound; }
        }
      }
      const finished = services.repositories.enrollmentRequest.update({ ...request, status: 'approved', revision: 1 });
      if (!finished.ok) return finished;
      request.status = 'approved'; request.revision = 1;
    }
    return success({ request, instances });
  });
}
