import type { JsonObject } from '@ctlflow/crossfire-kernel/json';

export type AgentRoomGrant = {
  agentId: string;
  roomId: string;
  generation: string;
  authorizerId: string;
  addedById: string;
  invitationEventId: string | null;
  admissionKind: 'managed' | 'invitation';
  accessMode: 'none' | 'read' | 'reply' | 'custom';
  nativeAccess: JsonObject | null;
  muted: boolean;
  revision: number;
  accessRevision: number;
  updatedAt: number;
};

export type AgentRoomPermission = {
  agentId: string;
  roomId: string;
  generation: string;
  permissionCode: string;
  grantScope: 'agent_room';
  grantedByMemberId: string;
  grantedAt: number;
};

export type RoomGrantApplication = {
  agentId: string;
  roomId: string;
  observedGeneration: string | null;
  appliedRevision: number | null;
  appliedAccessRevision: number | null;
  membership: 'join' | 'leave' | 'invite' | 'ban' | null;
  nativeAccess: JsonObject | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AgentWakeSender = {
  includeAgents: boolean;
  agentId: string;
  senderPrincipalId: string;
};
