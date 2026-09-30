import type { InstancePolicy, AuditEvent } from '@crossfire/domain/audit/types';
export function policy(value: InstancePolicy) {
  return { revision: value.revision, maxOwnerAgents: value.maxOwnerAgents, maxAgents: value.maxAgents, maxPending: value.maxPending,
    enrollmentSeconds: value.enrollmentSeconds, reconcileSeconds: value.reconcileSeconds, agentInstructions: value.agentInstructions,
    signupMode: value.signupMode, invitationIssuers: value.invitationIssuers };
}
export function audit(value: AuditEvent) {
  return { auditId: value.id, requestId: value.requestId, actorCredentialId: value.actorCredentialId, actorKind: value.actorKind, actorPrincipalId: value.actorPrincipalId, ownerId: value.ownerId,
    targetKind: value.targetKind, targetId: value.targetId, roomId: value.roomId, membershipGeneration: value.membershipGeneration,
    authorizerId: value.authorizerId, addedById: value.addedById, permissionCode: value.permissionCode, action: value.action,
    outcome: value.outcome, message: value.message, createdAt: value.createdAt };
}
