import type { AgentRoomGrant, RoomGrantApplication } from '@ctlflow/crossfire-domain/room-access/types';
import type { RoomDetails } from '@ctlflow/crossfire-domain/room/read-room';
import type { GrantPlanPreview } from '@ctlflow/crossfire-domain/room-access/grant-plan';
export function grant(value: AgentRoomGrant) {
  return { agentId: value.agentId, roomId: value.roomId, generation: value.generation, authorizerId: value.authorizerId, addedById: value.addedById,
    accessMode: value.accessMode, nativeAccess: value.nativeAccess, muted: value.muted, revision: value.revision, accessRevision: value.accessRevision, updatedAt: value.updatedAt };
}
export function application(value: RoomGrantApplication) {
  return { observedGeneration: value.observedGeneration, appliedRevision: value.appliedRevision, appliedAccessRevision: value.appliedAccessRevision,
    membership: value.membership, nativeAccess: value.nativeAccess, lastAttemptAt: value.lastAttemptAt, lastSuccessAt: value.lastSuccessAt,
    errorCode: value.errorCode, errorMessage: value.errorMessage };
}
export function grantView(value: { agentId: string; revision: number; ownerConversation: boolean; grant: AgentRoomGrant | null; application: RoomGrantApplication | null; permissions: string[]; allowedActions: string[] }) {
  return { agentId: value.agentId, revision: value.revision, ownerConversation: value.ownerConversation, grant: value.grant ? grant(value.grant) : null,
    application: value.application ? application(value.application) : null, permissions: value.permissions, allowedActions: value.allowedActions };
}
export function room(value: RoomDetails) {
  const facts = value.authority;
  return { roomId: value.roomId, name: value.name, topic: value.topic, alias: value.alias, authority: facts ? {
    backendUserId: facts.backendUserId, canInvite: facts.canInvite, authorityRevision: facts.authorityRevision,
    accessModes: facts.accessModes, accessFields: facts.accessFields, permissions: facts.permissions,
  } : null };
}
export function plan(value: GrantPlanPreview) {
  return { digest: value.digest, snapshots: value.snapshots.map(snapshot => ({ agentId: snapshot.agentId, revision: snapshot.revision,
    grants: snapshot.grants.map(item => ({ roomId: item.roomId, generation: item.generation, revision: item.revision })) })),
    changes: value.changes.map(change => ({ agentId: change.input.agentId, roomId: change.input.roomId,
      agentName: change.agentName, instanceKey: change.instanceKey, roomName: change.roomName, roomAlias: change.roomAlias,
      before: change.previous ? grant(change.previous) : null,
      after: change.input.accessMode === 'none' ? null : { roomId: change.input.roomId, accessMode: change.input.accessMode, nativeAccess: change.input.nativeAccess, muted: change.input.muted },
      changed: change.changed, authorizerId: change.authorizerId, authority: change.native ? {
        backendUserId: change.native.backendUserId, canInvite: change.native.canInvite, authorityRevision: change.native.authorityRevision,
        accessModes: change.native.accessModes, accessFields: change.native.accessFields, permissions: change.native.permissions,
      } : null })) };
}
