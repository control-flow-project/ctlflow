import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentItem } from './types.js';
import type { CoordinationPolicy } from '../fleet/coordination-policy.js';

export type EnrollmentItemView = EnrollmentItem & { currentName: string | null; coordinationPolicy: CoordinationPolicy };
export function enrollmentItemViews(services: Pick<Services, 'repositories' | 'directory'>, items: EnrollmentItem[]): Result<EnrollmentItemView[]> {
  if (!items.length) return success([]);
  if (items.some(item => item.requestId !== items[0]!.requestId)) return failure('invalid', 'An enrollment review contains exactly one request');
  const policies = services.repositories.fleetPolicy.requested(items[0]!.requestId);
  if (!policies.ok) return policies;
  const byInstance = new Map(policies.value.map(policy => [policy.instanceKey, policy]));
  if (items.some(item => !byInstance.has(item.instanceKey))) return failure('unavailable', 'Enrollment coordination policy is missing');
  const views: EnrollmentItemView[] = [];
  for (const item of items) {
    const policy = byInstance.get(item.instanceKey)!;
    const agent = item.agentId === null ? success(null) : services.directory.agent(item.agentId);
    if (!agent.ok) return agent;
    views.push({ ...item, currentName: agent.value?.name ?? null, coordinationPolicy: { wakeMode: policy.wakeMode,
      senderMatrixIds: [...policy.senderMatrixIds].sort(), permissions: policy.permissions } });
  }
  return success(views);
}
