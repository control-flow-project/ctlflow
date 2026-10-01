import type { Event } from './client.js';

export const LISTENER_NOTICE = 'org.crossfire.listener_notice';
export const BLOCKED_MENTION_INTERVAL_MS = 600_000;

export function isListenerNotice(event: { type: string; content: Record<string, unknown> }): boolean {
  return event.type === 'm.room.message' && event.content.msgtype === 'm.notice'
    && event.content[LISTENER_NOTICE] === true;
}

export function mentionsAgent(event: Pick<Event, 'type' | 'content' | 'sender'>, receiver: string): boolean {
  if (event.type !== 'm.room.message' || event.sender === receiver || event.content.msgtype !== 'm.text'
    || event.content['m.new_content'] !== undefined || isListenerNotice(event)) return false;
  const relation = event.content['m.relates_to'];
  if (relation && typeof relation === 'object' && !Array.isArray(relation) && relation.rel_type === 'm.replace') return false;
  const mentions = event.content['m.mentions'];
  return Boolean(mentions && typeof mentions === 'object' && !Array.isArray(mentions)
    && Array.isArray(mentions.user_ids) && mentions.user_ids.includes(receiver));
}
