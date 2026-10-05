import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentItem } from './types.js';
import type { CoordinationPolicy } from '../fleet/coordination-policy.js';

export type EnrollmentItemView = EnrollmentItem & { coordinationPolicy: CoordinationPolicy | null };
export function enrollmentItemViews(services: Pick<Services, 'repositories'>, items: EnrollmentItem[]): Result<EnrollmentItemView[]> {
  if (!items.length) return success([]);
  if (items.some(item => item.requestId !== items[0]!.requestId)) return failure('invalid', 'An enrollment review contains exactly one request');
  const policies = services.repositories.fleetPolicy.requested(items[0]!.requestId);
  if (!policies.ok) return policies;
  const byInstance = new Map(policies.value.map(policy => [policy.instanceKey, policy]));
  return success(items.map(item => {
    const policy = byInstance.get(item.instanceKey);
    return { ...item, coordinationPolicy: policy ? { wakeMode: policy.wakeMode,
      senderMatrixIds: [...policy.senderMatrixIds].sort(), permissions: policy.permissions } : null };
  }));
}
