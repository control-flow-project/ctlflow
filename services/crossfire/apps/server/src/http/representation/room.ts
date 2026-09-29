import type { AgentRoomGrant, RoomGrantApplication } from '../../../../../packages/domain/src/room-access/types.js';
import type { RoomDetails } from '../../../../../packages/domain/src/room/read-room.js';
import type { GrantPlanPreview } from '../../../../../packages/domain/src/room-access/grant-plan.js';
export function grant(value: AgentRoomGrant) {
  return { agentId: value.agentId, roomId: value.roomId, generation: value.generation, authorizerId: value.authorizerId, addedById: value.addedById,
    accessMode: value.accessMode, powerLevel: value.powerLevel, muted: value.muted, revision: value.revision, accessRevision: value.accessRevision, updatedAt: value.updatedAt };
}
export function application(value: RoomGrantApplication) {
  return { observedGeneration: value.observedGeneration, appliedRevision: value.appliedRevision, appliedAccessRevision: value.appliedAccessRevision,
    membership: value.membership, powerLevel: value.powerLevel, lastAttemptAt: value.lastAttemptAt, lastSuccessAt: value.lastSuccessAt,
    errorCode: value.errorCode, errorMessage: value.errorMessage };
}
export function grantView(value: { agentId: string; revision: number; grant: AgentRoomGrant | null; application: RoomGrantApplication | null; permissions: string[]; allowedActions: string[] }) {
  return { agentId: value.agentId, revision: value.revision, grant: value.grant ? grant(value.grant) : null,
    application: value.application ? application(value.application) : null, permissions: value.permissions, allowedActions: value.allowedActions };
}
export function room(value: RoomDetails) {
  const facts = value.authority;
  return { roomId: value.roomId, name: value.name, topic: value.topic, alias: value.alias, authority: facts ? {
    matrixUserId: facts.matrixUserId, powerLevel: facts.powerLevel, creator: facts.creator, creatorIds: facts.creatorIds, readLevel: facts.readLevel,
    replyLevel: facts.replyLevel, inviteLevel: facts.inviteLevel, kickLevel: facts.kickLevel, changePowerLevel: facts.changePowerLevel, nativePermissions: facts.nativePermissions,
  } : null };
}
export function plan(value: GrantPlanPreview) {
  return { digest: value.digest, snapshots: value.snapshots.map(snapshot => ({ agentId: snapshot.agentId, revision: snapshot.revision,
    grants: snapshot.grants.map(item => ({ roomId: item.roomId, generation: item.generation, revision: item.revision })) })),
    changes: value.changes.map(change => ({ agentId: change.input.agentId, roomId: change.input.roomId,
      before: change.previous ? grant(change.previous) : null,
      after: change.input.accessMode === 'none' ? null : { roomId: change.input.roomId, accessMode: change.input.accessMode, powerLevel: change.input.powerLevel, muted: change.input.muted },
      changed: change.changed, authorizerId: change.authorizerId, nativePowerLevel: change.native?.powerLevel ?? null })) };
}
