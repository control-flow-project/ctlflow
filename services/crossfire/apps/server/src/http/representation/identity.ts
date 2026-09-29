import type { MemberRecord } from '@crossfire/domain/port/directory';
import type { PrincipalApplication } from '@crossfire/domain/identity/types';
import type { AgentDetails } from '@crossfire/domain/agent/read-agent';
import type { ListenerRun } from '@crossfire/domain/activity/types';
export function application(value: PrincipalApplication) {
  return { appliedRevision: value.appliedRevision, appliedStatus: value.appliedStatus, nativeDisplayName: value.nativeDisplayName,
    lastAttemptAt: value.lastAttemptAt, lastSuccessAt: value.lastSuccessAt, errorCode: value.errorCode, errorMessage: value.errorMessage };
}
export function member(value: MemberRecord) {
  return { memberId: value.principal.id, matrixUserId: value.principal.matrixUserId, displayName: value.member.displayName,
    roleCode: value.role.roleCode, status: value.principal.status, revision: value.principal.revision, createdAt: value.principal.createdAt,
    application: application(value.application) };
}
export function listenerRun(value: ListenerRun) {
  return { runId: value.id, agentId: value.agentId, release: value.release, startedAt: value.startedAt, lastSeenAt: value.lastSeenAt,
    activeMs: value.activeMs, messagesDelivered: value.messagesDelivered, stoppedAt: value.stoppedAt, disconnectRequestedAt: value.disconnectRequestedAt };
}
export function agent(value: AgentDetails) {
  const { record, activity } = value;
  return { agentId: record.principal.id, matrixUserId: record.principal.matrixUserId, name: record.name,
    displayName: record.agent.displayNameOverride ?? record.name + ' (' + record.ownerMember.displayName + ')',
    owner: { memberId: record.owner.id, matrixUserId: record.owner.matrixUserId, displayName: record.ownerMember.displayName, status: record.owner.status },
    status: record.principal.status, revision: record.principal.revision, createdAt: record.principal.createdAt,
    application: application(record.application), activity: { status: activity.status, activeMs: activity.activeMs,
      messagesDelivered: activity.messagesDelivered, lastSeenAt: activity.lastSeenAt, activeRuns: activity.activeRuns.map(listenerRun) },
    deployment: value.deployment ? { fleetId: value.deployment.fleetId, fleetKey: value.deployment.fleetKey, label: value.deployment.label,
      controllerName: value.deployment.controllerName, reportedAt: value.deployment.reportedAt, instanceKey: value.deployment.instanceKey } : null,
    allowedActions: value.allowedActions };
}
