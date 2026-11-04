import { json, type JsonObject } from '@ctlflow/crossfire-kernel/json';
import type { EventType, MessageEvent } from '@ctlflow/crossfire-domain/port/messaging-client';
import { userId, roomId, eventId } from './syntax.js';
import type { MatrixEvent } from './values.js';

const types: Record<string, EventType> = {
  'm.room.message': 'message', 'm.room.member': 'membership', 'm.room.name': 'name', 'm.room.topic': 'topic',
  'm.room.power_levels': 'access', 'm.room.join_rules': 'join-policy', 'm.room.history_visibility': 'history-policy',
  'm.room.encryption': 'encryption', 'm.room.encrypted': 'encrypted', 'm.room.redaction': 'redaction', 'm.room.tombstone': 'migration',
};
export const IMPORTANT_EVENTS = Object.keys(types);
export const NOTICE_MARKER = 'org.crossfire.listener_notice';

export function nativeEventTypes(selected: readonly EventType[]): string[] {
  if (selected.includes('other')) throw new Error('Matrix filtering cannot request an exhaustive unknown-event category');
  return selected.flatMap(type => Object.keys(types).filter(key => types[key] === type));
}

export function messageEvent(event: MatrixEvent, room: string): MessageEvent {
  if (!roomId(room) || !event || !eventId(event.event_id) || !userId(event.sender) || typeof event.type !== 'string'
    || event.room_id !== undefined && event.room_id !== room || !event.content || typeof event.content !== 'object'
    || Array.isArray(event.content) || !json(event.content) || event.state_key !== undefined && typeof event.state_key !== 'string'
    || event.origin_server_ts !== undefined && (!Number.isSafeInteger(event.origin_server_ts) || Math.abs(event.origin_server_ts) > 8_640_000_000_000_000))
    throw new Error('Invalid Matrix event identity or content');
  const attributes = { ...event.content };
  const mentions = event.content['m.mentions'], relation = event.content['m.relates_to'];
  const ids = mentions && typeof mentions === 'object' && !Array.isArray(mentions) && Array.isArray(mentions.user_ids) ? mentions.user_ids : [];
  if (!ids.every(userId)) throw new Error('Invalid Matrix mention identities');
  const edited = event.content['m.new_content'] !== undefined || Boolean(relation && typeof relation === 'object' && !Array.isArray(relation) && relation.rel_type === 'm.replace');
  const kinds: Record<string, MessageEvent['content']['kind']> = { 'm.text': 'text', 'm.notice': 'notice', 'm.image': 'image', 'm.file': 'file', 'm.audio': 'audio', 'm.video': 'video', 'm.location': 'location' };
  const kind = typeof event.content.msgtype === 'string' && Object.hasOwn(kinds, event.content.msgtype) ? kinds[event.content.msgtype]! : 'other';
  const info = event.content.info && typeof event.content.info === 'object' && !Array.isArray(event.content.info) ? event.content.info : {};
  const attachment = typeof event.content.url === 'string' && ['image', 'file', 'audio', 'video'].includes(kind) ? [{
    id: event.content.url, name: typeof event.content.body === 'string' ? event.content.body : null,
    mediaType: typeof info.mimetype === 'string' ? info.mimetype : null,
    bytes: typeof info.size === 'number' && Number.isSafeInteger(info.size) && info.size >= 0 ? info.size : null,
  }] : [];
  for (const key of ['body', 'msgtype', 'm.mentions', NOTICE_MARKER]) delete attributes[key];
  if (typeof event.content.body === 'string') delete attributes.formatted_body;
  return { eventId: event.event_id, roomId: room, sender: event.sender, type: Object.hasOwn(types, event.type) ? types[event.type]! : 'other',
    subjectId: event.state_key ?? null, sentAt: event.origin_server_ts ?? null,
    ...(typeof event.content.body === 'string' && Object.hasOwn(event.content, 'formatted_body') ? { omitted: ['content.formatted_body'] } : {}),
    content: { kind, body: typeof event.content.body === 'string' ? event.content.body : null, mentions: ids as string[], edited,
      control: event.type === 'm.room.message' && kind === 'notice' && event.content[NOTICE_MARKER] === true,
      attachments: attachment, attributes: { eventType: event.type, content: attributes as JsonObject } } };
}
