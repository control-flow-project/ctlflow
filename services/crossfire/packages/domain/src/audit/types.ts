export type InstancePolicy = {
  id: 'instance';
  revision: number;
  maxOwnerAgents: number;
  maxAgents: number;
  maxPending: number;
  enrollmentSeconds: number;
  reconcileSeconds: number;
  agentInstructions: string;
};

export type AuditEvent = {
  id: string;
  requestId: string;
  actorCredentialId: string | null;
  actorKind: 'human' | 'agent' | 'controller' | 'system' | 'anonymous';
  actorPrincipalId: string | null;
  ownerId: string | null;
  targetKind: string;
  targetId: string;
  roomId: string | null;
  membershipGeneration: string | null;
  authorizerId: string | null;
  addedById: string | null;
  permissionCode: string | null;
  action: string;
  outcome: 'accepted' | 'rejected' | 'applied' | 'failed';
  message: string;
  createdAt: number;
};
