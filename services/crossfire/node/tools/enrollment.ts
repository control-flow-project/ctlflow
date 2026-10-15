import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { withHuman, type Credentials } from './auth.js';
import { coordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';

export const enrollmentPlan = check.object({ enrollmentId: check.identifier, ownerMatrixId: check.matrixUserId,
  verificationCode: check.text(12, 12), fleetKey: check.nullable(check.name), controllerName: check.nullable(check.text(100)),
  instances: check.list(check.object({ instanceKey: check.name, currentName: check.nullable(check.name), requestedName: check.name, coordinationPolicy: check.nullable(coordinationPolicy) }), 100, 1) });

export async function reviewEnrollment(origin: string, account: Credentials, plan: check.Parsed<typeof enrollmentPlan>, execute: boolean, signal: AbortSignal) {
  return withHuman(origin, account, signal, async human => {
    const current = await human.client.call(operations.enrollment, { enrollmentId: plan.enrollmentId }, {});
    if (!current.ok) return current;
    const review = current.value.data, record = review.enrollment;
    const roster = (instances: typeof plan.instances) => JSON.stringify(instances.map(item => [item.instanceKey, item.currentName, item.requestedName,
      item.coordinationPolicy ? { wakeMode: item.coordinationPolicy.wakeMode, senders: [...item.coordinationPolicy.senders].sort((left, right) => left.matrixUserId.localeCompare(right.matrixUserId)),
        permissions: [...item.coordinationPolicy.permissions].sort() } : null]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
    if (record.status !== 'pending' || record.owner.matrixUserId !== plan.ownerMatrixId || record.fleetKey !== plan.fleetKey
      || record.controllerName !== plan.controllerName || record.verificationCode !== plan.verificationCode
      || roster(review.instances) !== roster(plan.instances)) return failure('conflict', 'Enrollment differs from the supplied owner, controller, roster, coordination policies or code; no approval sent');
    if (human.viewer.member.matrixUserId !== plan.ownerMatrixId) return failure('forbidden', 'Only the intended owner may approve this enrollment');
    if (execute) {
      const decision = await human.client.call(operations.decideEnrollment, { enrollmentId: plan.enrollmentId }, {
        expectedRevision: record.revision, decision: 'approve', verificationCode: plan.verificationCode,
      });
      if (!decision.ok) return decision;
    }
    return success({ enrollmentId: plan.enrollmentId, owner: plan.ownerMatrixId, fleetKey: plan.fleetKey,
      controllerName: plan.controllerName, instances: plan.instances, approved: execute, reviewedRevision: record.revision });
  });
}
