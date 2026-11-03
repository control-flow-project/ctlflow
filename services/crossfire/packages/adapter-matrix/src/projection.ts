import type { JsonObject } from '@ctlflow/crossfire-kernel/json';
import type { MatrixSync } from './values.js';

export function projectMessages(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error('Response nesting exceeds the projection bound');
  if (Array.isArray(value)) return value.map(item => projectMessages(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const object = value as JsonObject;
  if (typeof object.event_id === 'string' && object.content && typeof object.content === 'object' && !Array.isArray(object.content)) {
    const content = { ...object.content };
    if (typeof content.body === 'string' && content.formatted_body !== undefined) {
      delete content.formatted_body;
      return { ...object, content, omitted: ['content.formatted_body'] };
    }
    return object;
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, projectMessages(item, depth + 1)]));
}
export function inbox(sync: MatrixSync) {
  return { next_batch: sync.next_batch, rooms: Object.entries(sync.rooms?.join ?? {}).map(([room_id, room]) => ({ room_id,
    notifications: room.unread_notifications ?? null,
    read_state: room.account_data?.events?.filter(event => ['m.fully_read', 'm.marked_unread'].includes(String(event.type))) ?? [],
    timeline_limited: room.timeline?.limited ?? false,
  })), invitations: Object.keys(sync.rooms?.invite ?? {}), left: Object.keys(sync.rooms?.leave ?? {}),
  count_semantics: 'Matrix notifications, not total unread messages; room message totals are unavailable' };
}
