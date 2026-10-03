import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { GrantChange } from '../room-access/authorize-change.js';

type Dependencies = Pick<Services, 'repositories' | 'runtime'>;
type PrivateConversation = { kind: 'agent'; agentId: string } | { kind: 'management'; ownerId: string };
export function privateConversation(services: Dependencies, roomId: string): Result<PrivateConversation | null> {
  const conversation = services.repositories.ownerConversation.findByRoom({ roomId });
  if (!conversation.ok) return conversation;
  if (conversation.value) return success({ kind: 'agent', agentId: conversation.value.agentId });
  const management = services.runtime.conversationByRoom(roomId);
  return management.ok ? success(management.value ? { kind: 'management', ownerId: management.value.ownerId } : null) : management;
}
export function protectOwnerConversation(services: Dependencies, input: GrantChange) {
  const conversation = privateConversation(services, input.roomId);
  if (!conversation.ok) return conversation;
  if (conversation.value && (conversation.value.kind === 'management' || conversation.value.agentId !== input.agentId)) return failure('forbidden', 'Another agent cannot join a private owner DM');
  return conversation.value && (input.accessMode !== 'reply' || input.powerLevel !== null || input.muted)
    ? failure('forbidden', 'Owner DMs always have read-and-reply access and cannot be muted or removed') : success(undefined);
}
