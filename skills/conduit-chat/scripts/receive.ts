import { existsSync } from 'node:fs';
import { API, Matrix, ensureObserver, readJson, roomCatalog, segment, selectRoom,
  type Account, type Event, type Settings } from './lib.ts';

type Page = { chunk: Event[]; end?: string };
type Sync = { next_batch: string; rooms?: { invite?: Record<string, { invite_state: { events: Event[] } }> } };
export type ReceivedEvent = ReturnType<typeof eventView>;
export type ReadBatch = {
  events: ReceivedEvent[];
  cursors: Record<string, string>;
  more_rooms: string[];
};

export function eventView(event: Event, room: string) {
  if (!event || typeof event.event_id !== 'string' || !event.event_id || typeof event.sender !== 'string'
      || !event.sender || typeof event.type !== 'string' || !event.content || typeof event.content !== 'object'
      || Array.isArray(event.content)) throw new Error('Invalid Matrix event identity or content');
  return { room_id: room, event_id: event.event_id, sender: event.sender,
    type: event.type, content: event.content,
    timestamp: event.origin_server_ts === undefined ? undefined : new Date(event.origin_server_ts).toISOString() };
}

export async function sharedRooms(client: Matrix, settings: Settings): Promise<void> {
  const catalog = roomCatalog(await new Matrix(settings.room_service, client.token, client.signal).get('/_coord/rooms'));
  Object.assign(settings, catalog);
  const joined = new Set((await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms);
  for (const room of settings.rooms) {
    if (!joined.has(room.room_id)) await client.post(`${API}/join/${segment(room.room_id)}`, {});
    await ensureObserver(client, room.room_id, settings);
  }
}

export async function synchronize(client: Matrix, settings: Settings, account: Account,
  since?: string, timeout = 0): Promise<string> {
  const result = await client.get<Sync>(API + '/sync', { timeout, ...(since ? { since } : {}), filter: JSON.stringify({
    presence: { types: [] }, account_data: { types: [] },
    room: { timeline: { limit: 1 }, state: { types: ['m.room.member'] },
      ephemeral: { types: [] }, account_data: { types: [] } },
  }) });
  if (typeof result.next_batch !== 'string' || !result.next_batch) throw new Error('Matrix sync has no continuation');
  for (const [room, invite] of Object.entries(result.rooms?.invite ?? {})) {
    if (invite.invite_state.events.some(event => event.type === 'm.room.member'
        && event.state_key === account.user_id && event.sender === settings.observer
        && event.content.membership === 'invite')) {
      await client.post(`${API}/join/${segment(room)}`, {});
      await ensureObserver(client, room, settings);
    }
  }
  return result.next_batch;
}

export async function readUnread(client: Matrix, settings: Settings, cursorFile: string,
  limit: number, selector?: string): Promise<ReadBatch> {
  const rooms = selector ? [selectRoom(settings, selector)]
    : (await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms;
  const cursors = existsSync(cursorFile) ? readJson<Record<string, string>>(cursorFile) : {};
  if (!cursors || Array.isArray(cursors) || typeof cursors !== 'object'
      || Object.values(cursors).some(value => typeof value !== 'string')) throw new Error('Invalid saved read cursors');
  const events: ReceivedEvent[] = [];
  const more_rooms: string[] = [];
  for (const room of rooms.sort()) {
    await ensureObserver(client, room, settings);
    const query: Record<string, string | number> = { dir: 'f', limit };
    if (cursors[room]) query.from = cursors[room];
    const page = await client.get<Page>(`${API}/rooms/${segment(room)}/messages`, query);
    if (!Array.isArray(page.chunk) || page.chunk.length > limit || (page.end !== undefined && typeof page.end !== 'string')) {
      throw new Error('Invalid Matrix message page');
    }
    if (page.chunk.length > 0 && (!page.end || page.end === cursors[room])) {
      throw new Error('Matrix message page does not advance its cursor');
    }
    if (page.end) cursors[room] = page.end;
    if (page.chunk.length >= limit) more_rooms.push(room);
    for (const event of page.chunk) {
      if (['m.room.message', 'm.room.encrypted', 'm.room.redaction'].includes(event.type)) events.push(eventView(event, room));
    }
  }
  return { events, cursors, more_rooms };
}
