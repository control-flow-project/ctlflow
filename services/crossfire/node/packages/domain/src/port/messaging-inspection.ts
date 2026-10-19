import type { Result } from '@ctlflow/crossfire-kernel/result';

export type MessagingInspection = {
  verifyProfile(userId: string, displayName: string): Promise<Result<void>>;
  joinedRooms(): Promise<Result<string[]>>;
  close(): Promise<Result<void>>;
};
