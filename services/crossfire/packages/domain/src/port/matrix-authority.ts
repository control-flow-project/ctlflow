import type { Result } from '@ctlflow/crossfire-kernel/result';
export type MatrixAccount = { userId: string; accessToken: string; deviceId: string };
export type RoomPower = { creator: true; powerLevel: null } | { creator: false; powerLevel: number };
export type RoomFacts = {
  roomId: string; name: string; topic: string; alias: string | null;
  matrixUserId: string; creatorIds: string[];
  readLevel: number; replyLevel: number; inviteLevel: number; kickLevel: number;
  changePowerLevel: number; nativePermissions: { action: string; level: number }[];
} & RoomPower;
export type RoomMembership = { matrixUserId: string; displayName: string; membership: 'join' | 'invite' | 'leave' | 'ban' }
  & RoomPower;
export type RoomAccess = { mode: 'read' | 'reply' | 'custom'; powerLevel: number };
export type RoomInvitation = { roomId: string; eventId: string; senderMatrixId: string; direct: boolean };
export type RoomAdmission = { kind: 'managed' } | { kind: 'invitation'; eventId: string; senderMatrixId: string };
export type MatrixEvent = { eventId: string; roomId: string; senderMatrixId: string; type: string; messageType: string | null; body: string | null; mentions: string[]; edited: boolean; control: boolean };
export type MatrixAuthority = {
  identify(token: string): Promise<Result<string>>;
  exists(matrixUserId: string): Promise<Result<boolean>>;
  provision(matrixUserId: string, password: string, deviceId: string): Promise<Result<MatrixAccount>>;
  deactivate(matrixUserId: string): Promise<Result<void>>;
  discard(matrixUserId: string): Promise<Result<void>>;
  profileName(matrixUserId: string): Promise<Result<string | null>>;
  setDisplayName(matrixUserId: string, displayName: string): Promise<Result<void>>;
  joined(matrixUserId: string): Promise<Result<string[]>>;
  ownerConversation(ownerMatrixId: string, agentMatrixId: string, roomId: string | null): Promise<Result<string>>;
  verifyOwnerConversation(ownerMatrixId: string, agentMatrixId: string, roomId: string): Promise<Result<void>>;
  markDirect(matrixUserId: string, counterpartMatrixId: string, roomId: string): Promise<Result<void>>;
  room(matrixUserId: string, roomId: string): Promise<Result<RoomFacts>>;
  membership(matrixUserId: string, targetMatrixId: string, roomId: string): Promise<Result<RoomMembership>>;
  invitation(matrixUserId: string, roomId: string): Promise<Result<RoomInvitation | null>>;
  setRoomAccess(authorizerMatrixId: string, targetMatrixId: string, roomId: string, access: RoomAccess, admission: RoomAdmission | null): Promise<Result<RoomMembership>>;
  leave(matrixUserId: string, roomId: string): Promise<Result<void>>;
  event(matrixUserId: string, roomId: string, eventId: string): Promise<Result<MatrixEvent>>;
  sendNotice(matrixUserId: string, roomId: string, transactionId: string, body: string, senderMatrixId: string): Promise<Result<string>>;
  close(): void;
};
