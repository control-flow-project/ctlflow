import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { PrincipalSummary } from '../port/discovery.js';
import type { EnrollmentRequest } from './types.js';

export type EnrollmentOverview = { request: EnrollmentRequest; owner: PrincipalSummary };
export function enrollmentOverviews(services: Pick<Services, 'discovery'>, requests: EnrollmentRequest[]): Result<EnrollmentOverview[]> {
  if (!requests.length) return success([]);
  const owners = services.discovery.selected([...new Set(requests.map(request => request.ownerId))]);
  if (!owners.ok) return owners;
  const identities = new Map(owners.value.map(owner => [owner.principalId, owner]));
  const results: EnrollmentOverview[] = [];
  for (const request of requests) {
    const owner = identities.get(request.ownerId);
    if (!owner || owner.kind !== 'human') return failure('unavailable', 'Enrollment owner is unavailable');
    results.push({ request, owner });
  }
  return success(results);
}
