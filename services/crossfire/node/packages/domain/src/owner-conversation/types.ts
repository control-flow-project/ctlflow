import type { Result } from '@ctlflow/crossfire-kernel/result';

export type OwnerConversation = {
  agentId: string;
  ownerId: string;
  roomId: string;
  createdAt: number;
};

export type OwnerConversationRepository = {
  find(key: { agentId: string }): Result<OwnerConversation | null>;
  findByRoom(key: { roomId: string }): Result<OwnerConversation | null>;
  insert(value: OwnerConversation): Result<void>;
};
