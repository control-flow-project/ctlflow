import { failure } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import { ensureOwnerConversation } from './ensure.js';

export function connectOwnerConversation(services: Services, actor: Actor, agentId: string) {
  const authorized = authorize(services, actor, 'owner-conversation.ensure.self');
  if (!authorized.ok) return Promise.resolve(authorized);
  if (actor.kind !== 'agent' || actor.principalId !== agentId) return Promise.resolve(failure('forbidden', 'Only this agent can connect its owner conversation'));
  return ensureOwnerConversation(services, agentId);
}
