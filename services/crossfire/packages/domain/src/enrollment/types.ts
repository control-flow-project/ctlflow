export type EnrollmentRequest = {
  controllerName: string;
  controllerCredentialHash: string;
  id: string;
  ownerId: string;
  fleetKey: string;
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
  outcome: 'existing' | 'claimed';
  agentId: string | null;
};

export type AgentName = {
  name: string;
  requestId: string | null;
  instanceKey: string | null;
  agentId: string | null;
};

export type Fleet = {
  archivedAt: number | null;
  id: string;
  deliveryEnabled: boolean;
  label: string;
  controllerName: string;
  revision: number;
  updatedAt: number;
  ownerId: string;
  fleetKey: string;
  createdAt: number;
};

export type FleetInstance = {
  retiredAt: number | null;
  ownerId: string;
  fleetKey: string;
  instanceKey: string;
  agentId: string;
};

export type FleetCredential = {
  id: string;
  fleetId: string;
  secretHash: string;
  createdAt: number;
  revokedAt: number | null;
};

export type FleetControllerMetadata = {
  fleetId: string;
  key: string;
  value: string;
};

export type EnrollmentControllerMetadata = {
  enrollmentId: string;
  key: string;
  value: string;
};
