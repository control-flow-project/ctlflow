import type { EnrollmentRequest, EnrollmentItem, Fleet } from '../../../../../packages/domain/src/enrollment/types.js';
import type { MemberInvitation } from '../../../../../packages/domain/src/activity/types.js';
export function enrollment(value: EnrollmentRequest) {
  return { enrollmentId: value.id, ownerId: value.ownerId, fleetKey: value.fleetKey, verificationCode: value.verificationCode, status: value.status,
    revision: value.revision, createdAt: value.createdAt, expiresAt: value.expiresAt, decidedByMemberId: value.decidedByMemberId, decidedAt: value.decidedAt };
}
export function enrollmentItem(value: EnrollmentItem) {
  return { instanceKey: value.instanceKey, requestedName: value.requestedName, outcome: value.outcome, agentId: value.agentId, failureCode: value.failureCode };
}
export function enrollmentDetails(value: { request: EnrollmentRequest; instances: EnrollmentItem[] }) {
  return { enrollment: enrollment(value.request), instances: value.instances.map(enrollmentItem) };
}
export function fleet(value: Fleet) { return { ownerId: value.ownerId, fleetKey: value.fleetKey, createdAt: value.createdAt }; }
export function invitation(value: MemberInvitation) {
  return { invitationId: value.id, createdByMemberId: value.createdByMemberId, roleCode: value.roleCode, createdAt: value.createdAt,
    expiresAt: value.expiresAt, consumedByMemberId: value.consumedByMemberId, revokedAt: value.revokedAt };
}
