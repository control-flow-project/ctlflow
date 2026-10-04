import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentIntroduction } from './input.js';
import { controllerToken } from '../fleet/authority.js';
import { bindRoster } from '../fleet/bind-roster.js';
import { verifyRoster } from './preflight.js';
import { expireEnrollments } from './expire.js';
import type { EnrollmentRequest, EnrollmentItem } from './types.js';
import { enrollmentCapacity } from './capacity.js';
import { enrollmentOverviews, type EnrollmentOverview } from './overview.js';
import { validateRoster } from './input.js';
import { coordinationPolicyMatches } from '../fleet/policy.js';
import { validateWakeSenders } from '../wake/replace-policy.js';
import { enrollmentItemViews, type EnrollmentItemView } from './item-view.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'matrix' | 'unitOfWork' | 'identity' | 'clock'>;
export type EnrollmentReceipt = EnrollmentOverview & { instances: EnrollmentItemView[] };
function receipt(services: Dependencies, request: EnrollmentRequest, instances: EnrollmentItem[]): Result<EnrollmentReceipt> {
  const overview = enrollmentOverviews(services, [request]);
  if (!overview.ok) return overview;
  const views = enrollmentItemViews(services, instances);
  return views.ok ? success({ ...overview.value[0]!, instances: views.value }) : views;
}
export async function introduceEnrollment(services: Dependencies, input: EnrollmentIntroduction): Promise<Result<EnrollmentReceipt>> {
  if (!/^[a-f0-9-]{36}$/u.test(input.enrollmentId) || !/^[A-Za-z0-9_-]{43}$/u.test(input.claimSecret)) return failure('invalid', 'Persist a request UUID and private 32-byte claim before enrollment');
  const valid = validateRoster(input);
  if (!valid.ok) return valid;
  const rosterDigest = services.identity.hash(JSON.stringify({ owner: input.ownerMatrixId, fleet: input.fleetKey,
    controller: input.controller ? { name: input.controller.name, metadata: Object.entries(input.controller.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right)) } : null,
    items: input.instances.map(item => [item.instanceKey, item.name, item.identity?.agentId ?? null,
      item.coordinationPolicy ? { wakeMode: item.coordinationPolicy.wakeMode, senderMatrixIds: [...item.coordinationPolicy.senderMatrixIds].sort(),
        permissions: [...item.coordinationPolicy.permissions].sort() } : null]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) }));
  const prior = services.repositories.enrollmentRequest.find({ id: input.enrollmentId }); if (!prior.ok) return prior;
  if (prior.value) {
    if (prior.value.expiresAt <= services.clock.now() || prior.value.rosterDigest !== rosterDigest || !services.identity.matches(input.claimSecret, prior.value.claimHash)) return failure('conflict', 'Enrollment request belongs to different credentials or roster, or has expired');
    const items = services.collection.enrollmentItems({ requestId: input.enrollmentId });
    return items.ok ? receipt(services, prior.value, items.value) : items;
  }
  const verified = await verifyRoster(services, input);
  if (!verified.ok) return verified;
  return services.unitOfWork.run(() => {
    const expired = expireEnrollments(services);
    if (!expired.ok) return expired;
    const previous = services.repositories.enrollmentRequest.find({ id: input.enrollmentId });
    if (!previous.ok) return previous;
    if (previous.value) {
      if (previous.value.rosterDigest !== rosterDigest || !services.identity.matches(input.claimSecret, previous.value.claimHash)) return failure('conflict', 'Enrollment request belongs to different credentials or roster');
      const items = services.collection.enrollmentItems({ requestId: input.enrollmentId });
      return items.ok ? receipt(services, previous.value, items.value) : items;
    }
    const owner = services.repositories.principal.find({ id: verified.value.ownerId });
    if (!owner.ok) return owner;
    if (!owner.value || owner.value.revision !== verified.value.ownerRevision || owner.value.status !== 'active') return failure('conflict', 'Owner authority changed');
    for (const item of verified.value.existing) {
      const principal = services.repositories.principal.find({ id: item.agentId });
      if (!principal.ok) return principal;
      if (!principal.value || principal.value.status !== 'active' || principal.value.revision !== item.revision) return failure('conflict', 'Existing agent authority changed');
    }
    const capacity = enrollmentCapacity(services, owner.value.id);
    if (!capacity.ok) return capacity;
    const policy = capacity.value.policy;
    const pendingRequests = services.collection.pendingEnrollmentCount();
    if (!pendingRequests.ok) return pendingRequests;
    if (pendingRequests.value >= policy.maxPending) return failure('limit', 'Pending enrollment capacity reached');
    let remaining = capacity.value.remaining;
    const now = services.clock.now();
    const request: EnrollmentRequest = { controllerName: input.controller?.name ?? null,
      controllerCredentialHash: input.controller ? services.identity.hash(controllerToken(services, input.enrollmentId, input.claimSecret)) : null, id: input.enrollmentId, ownerId: owner.value.id, fleetKey: input.fleetKey,
      verificationCode: services.identity.verificationCode(), claimHash: services.identity.hash(input.claimSecret), rosterDigest,
      status: 'pending', revision: 0, createdAt: now, expiresAt: now + policy.enrollmentSeconds * 1000, decidedByMemberId: null, decidedAt: null };
    const saved = services.repositories.enrollmentRequest.insert(request);
    if (!saved.ok) return saved;
    for (const [key, value] of Object.entries(input.controller?.metadata ?? {})) {
      const saved = services.repositories.enrollmentControllerMetadata.insert({ enrollmentId: request.id, key, value }); if (!saved.ok) return saved;
    }
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
      const requestedPolicy = verified.value.policies.find(entry => entry.instanceKey === item.instanceKey)?.policy;
      if (requestedPolicy) {
        const valid = validateWakeSenders(services, existing?.agentId ?? null, requestedPolicy.wakeMode, requestedPolicy.senderIds);
        if (!valid.ok) return valid;
        const savedPolicy = services.repositories.fleetPolicy.insertRequested(record, requestedPolicy);
        if (!savedPolicy.ok) return savedPolicy;
      }
      if (record.outcome === 'claimed') {
        const claimed = services.repositories.agentName.insert({ name: item.name, requestId: request.id, instanceKey: item.instanceKey, agentId: null });
        if (!claimed.ok) return claimed;
        remaining--;
      }
      instances.push(record);
    }
    const existingFleet = input.fleetKey === null ? success(null) : services.repositories.fleet.find({ ownerId: owner.value.id, fleetKey: input.fleetKey });
    if (!existingFleet.ok) return existingFleet;
    let unchanged = true;
    for (const item of instances) {
      if (input.fleetKey === null || item.outcome !== 'existing' || !item.agentId) continue;
      const requestedPolicy = verified.value.policies.find(entry => entry.instanceKey === item.instanceKey)?.policy;
      if (!requestedPolicy) return failure('invalid', 'Fleet instance coordination policy is missing');
      const matches = coordinationPolicyMatches(services, item.agentId, requestedPolicy);
      if (!matches.ok) return matches;
      unchanged = unchanged && matches.value;
    }
    if ((input.fleetKey === null || existingFleet.value && unchanged) && !instances.some(item => item.outcome === 'claimed')) {
      if (existingFleet.value) {
        const bound = bindRoster(services, owner.value.id, existingFleet.value.fleetKey, instances);
        if (!bound.ok) return bound;
      }
      const finished = services.repositories.enrollmentRequest.update({ ...request, status: 'approved', revision: 1 });
      if (!finished.ok) return finished;
      request.status = 'approved'; request.revision = 1;
    }
    return receipt(services, request, instances);
  });
}
