import type { Result } from '@crossfire/kernel/result';

export type OwnerConversation = {
  agentId: string;
  ownerId: string;
  roomId: string;
  createdAt: number;
};

export type OwnerConversationRepository = {
  find(key: { agentId: string }): Result<OwnerConversation | null>;
  insert(value: OwnerConversation): Result<void>;
};
