export type AgentRoomGrant = {
  agentId: string;
  roomId: string;
  generation: string;
  authorizerId: string;
  addedById: string;
  accessMode: 'none' | 'read' | 'reply' | 'custom';
  powerLevel: number | null;
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
  powerLevel: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AgentWakeSender = {
  agentId: string;
  senderPrincipalId: string;
};
