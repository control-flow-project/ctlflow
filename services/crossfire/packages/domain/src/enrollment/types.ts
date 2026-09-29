export type EnrollmentRequest = {
  id: string;
  ownerId: string;
  fleetKey: string | null;
  verificationCode: string;
  claimHash: string;
  rosterDigest: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  revision: number;
  createdAt: number;
  expiresAt: number;
  decidedByMemberId: string | null;
  decidedAt: number | null;
};

export type EnrollmentItem = {
  requestId: string;
  instanceKey: string;
  requestedName: string;
  outcome: 'existing' | 'claimed' | 'failed';
  agentId: string | null;
  failureCode: string | null;
};

export type AgentName = {
  name: string;
  requestId: string | null;
  instanceKey: string | null;
  agentId: string | null;
};

export type Fleet = {
  ownerId: string;
  fleetKey: string;
  createdAt: number;
};

export type FleetInstance = {
  ownerId: string;
  fleetKey: string;
  instanceKey: string;
  agentId: string;
};
