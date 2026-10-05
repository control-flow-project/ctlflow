import type { EnrollmentItemView } from '@ctlflow/crossfire-domain/enrollment/item-view';
import type { EnrollmentOverview } from '@ctlflow/crossfire-domain/enrollment/overview';
import type { EnrollmentReceipt } from '@ctlflow/crossfire-domain/enrollment/introduce';
import type { FleetDetails } from '@ctlflow/crossfire-domain/fleet/read-fleet';
import type { MemberInvitation } from '@ctlflow/crossfire-domain/activity/types';
export function enrollment({ request: value, owner }: EnrollmentOverview) {
  return { owner, controllerName: value.controllerName, enrollmentId: value.id, ownerId: value.ownerId, fleetKey: value.fleetKey, verificationCode: value.verificationCode, status: value.status,
    revision: value.revision, createdAt: value.createdAt, expiresAt: value.expiresAt, decidedByMemberId: value.decidedByMemberId, decidedAt: value.decidedAt };
}
export function enrollmentItem(value: EnrollmentItemView) {
  return { instanceKey: value.instanceKey, requestedName: value.requestedName, outcome: value.outcome, agentId: value.agentId,
    failureCode: value.failureCode, coordinationPolicy: value.coordinationPolicy };
}
export function enrollmentDetails(value: EnrollmentReceipt) {
  return { enrollment: enrollment(value), instances: value.instances.map(enrollmentItem) };
}
export function fleet(value: FleetDetails) { return { fleetId: value.id, owner: value.owner, fleetKey: value.fleetKey,
  label: value.label, controller: { name: value.controllerName, metadata: value.metadata }, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
  delivery: { fleetId: value.id, revision: value.revision, deliveryEnabled: value.deliveryEnabled, connection: value.connection } }; }
export function invitation(value: MemberInvitation) {
  return { invitationId: value.id, createdByMemberId: value.createdByMemberId, roleCode: value.roleCode, createdAt: value.createdAt,
    expiresAt: value.expiresAt, consumedByMemberId: value.consumedByMemberId, revokedAt: value.revokedAt };
}
