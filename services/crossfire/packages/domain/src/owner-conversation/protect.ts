import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { GrantChange } from '../room-access/authorize-change.js';

export function protectOwnerConversation(services: Pick<Services, 'repositories'>, input: GrantChange) {
  const conversation = services.repositories.ownerConversation.find({ agentId: input.agentId });
  if (!conversation.ok) return conversation;
  return conversation.value?.roomId === input.roomId && (input.accessMode !== 'reply' || input.powerLevel !== null || input.muted)
    ? failure('forbidden', 'Owner DMs always have read-and-reply access and cannot be muted or removed') : success(undefined);
}
