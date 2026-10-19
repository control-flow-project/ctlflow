import type { MessageEvent } from './client.js';

export const BLOCKED_MENTION_INTERVAL_MS = 600_000;

export function isListenerNotice(event: Pick<MessageEvent, 'type' | 'content'>): boolean {
  return event.type === 'message' && event.content.kind === 'notice' && event.content.control;
}

export function mentionsAgent(event: Pick<MessageEvent, 'type' | 'content' | 'sender'>, receiver: string): boolean {
  return event.type === 'message' && event.sender !== receiver && event.content.kind === 'text'
    && !event.content.edited && !event.content.control && event.content.mentions.includes(receiver);
}
