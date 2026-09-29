import type { MemberRecord } from '../../../../../packages/domain/src/port/directory.js';
import type { PrincipalApplication } from '../../../../../packages/domain/src/identity/types.js';
import type { AgentDetails } from '../../../../../packages/domain/src/agent/read-agent.js';
import type { ListenerRun } from '../../../../../packages/domain/src/activity/types.js';
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
    allowedActions: value.allowedActions };
}
