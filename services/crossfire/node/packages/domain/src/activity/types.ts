export type MemberInvitation = {
  id: string;
  createdByMemberId: string;
  claimHash: string;
  roleCode: 'member' | 'administrator';
  principalKind: 'human';
  createdAt: number;
  expiresAt: number;
  consumedByMemberId: string | null;
  revokedAt: number | null;
  claimMatrixUserId: string | null;
  claimDisplayName: string | null;
  claimFingerprint: string | null;
};

export type MemberSession = {
  secretHash: string;
  memberId: string;
  csrfSecret: string;
  nativeAccessToken: string;
  createdAt: number;
  expiresAt: number;
};

export type ListenerRun = {
  controller: { fleetId: string; connectionId: string; credentialId: string } | null;
  id: string;
  agentId: string;
  release: string | null;
  startedAt: number;
  lastSeenAt: number;
  activeMs: number;
  messagesDelivered: number;
  stoppedAt: number | null;
  disconnectRequestedAt: number | null;
};

export type WakeNotice = {
  receiverAgentId: string;
  eventId: string;
  senderMatrixId: string;
  roomId: string;
  reservedAt: number;
  messageBody: string;
  status: 'pending' | 'sent' | 'denied';
  sentAt: number | null;
  nativeEventId: string | null;
  nextAttemptAt: number | null;
  lastError: string | null;
};
