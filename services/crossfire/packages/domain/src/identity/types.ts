export type Principal = {
  id: string;
  matrixUserId: string;
  kind: 'human' | 'agent';
  status: 'active' | 'suspended' | 'revoked';
  revision: number;
  createdAt: number;
};

export type Member = {
  principalId: string;
  principalKind: 'human';
  displayName: string;
};

export type Agent = {
  principalId: string;
  principalKind: 'agent';
  ownerId: string;
  wakeMode: 'humans' | 'everyone' | 'selected';
};

export type AgentCredential = {
  agentId: string;
  provisioningPassword: string;
  accessToken: string | null;
  updatedAt: number;
};

export type PrincipalApplication = {
  principalId: string;
  appliedRevision: number | null;
  appliedIntentHash: string | null;
  appliedStatus: 'active' | 'suspended' | 'revoked' | null;
  nativeDisplayName: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  errorCode: string | null;
  errorMessage: string | null;
};
