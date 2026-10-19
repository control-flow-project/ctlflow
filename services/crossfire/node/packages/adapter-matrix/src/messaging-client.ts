import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { MessagingClient, MessageFeed, MessagePageRequest, RoomOrigin } from '@ctlflow/crossfire-domain/port/messaging-client';
import type { JsonObject } from '@ctlflow/crossfire-kernel/json';
import { API, segment } from './protocol.js';
import { roomState, ownerConversationState, roomPowers } from './room/state.js';
import { DEFAULT_EVENTS } from '@ctlflow/crossfire-contracts/limits';
import type { Matrix } from './http.js';
import type { MatrixEvent, MatrixSync } from './values.js';
import { IMPORTANT_EVENTS, messageEvent, nativeEventTypes } from './events.js';
import { ownerNotice, ownerNoticeChunks, ownerNoticeFits } from './notices.js';
import { userId, roomId, eventId } from './syntax.js';

const maximumCollectionBytes = 64 * 1024 * 1024;
type NativePage = { chunk: MatrixEvent[]; start?: string; end?: string; requestedLimit: number };
function overflow(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'body_too_large'; }

export function createMessagingClient(client: Matrix, self: string): MessagingClient {
  if (!userId(self)) throw new Error('Expected a Matrix receiver identity');
  async function history(room: string, request: MessagePageRequest): Promise<NativePage> {
    if (!roomId(room) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new Error('Invalid Matrix history request');
    let limit = request.limit;
    for (;;) {
      try {
        const filter = request.filter ? { ...(request.filter.types ? { types: nativeEventTypes(request.filter.types) } : {}),
          ...(request.filter.senders ? { senders: request.filter.senders } : {}) } : undefined;
        const page = await client.get<NativePage>(`${API}/rooms/${segment(room)}/messages`, { dir: request.direction === 'forward' ? 'f' : 'b', limit,
          ...(request.from ? { from: request.from } : {}), ...(request.to ? { to: request.to } : {}), ...(filter ? { filter: JSON.stringify(filter) } : {}) },
        limit === 1 ? maximumCollectionBytes : undefined);
        if (!page || !Array.isArray(page.chunk) || page.chunk.length > limit || page.start !== undefined && typeof page.start !== 'string'
          || page.end !== undefined && typeof page.end !== 'string' || page.chunk.length > 0 && (!page.end || page.end === request.from))
          throw new Error('Invalid or nonadvancing Matrix message page');
        return { ...page, requestedLimit: limit };
      } catch (error) {
        if (!overflow(error)) throw error;
        if (limit === 1) throw Object.assign(new Error('A Matrix history event exceeds the collection resource bound; unread positions are unchanged'), { code: 'limit' });
        limit = Math.max(1, Math.floor(limit / 2));
      }
    }
  }
  async function synchronize(since?: string, timeout = 0): Promise<MessageFeed> {
    let limit = DEFAULT_EVENTS, native: MatrixSync;
    for (;;) {
      try {
        native = await client.get<MatrixSync>(API + '/sync', { timeout, ...(since ? { since } : {}), filter: JSON.stringify({
          presence: { types: [] }, account_data: { types: [] }, room: { timeline: { limit, types: IMPORTANT_EVENTS }, state: { types: ['m.room.member'] },
            ephemeral: { types: [] }, account_data: { types: ['m.fully_read', 'm.marked_unread'] } },
        }) }, limit <= 1 ? maximumCollectionBytes : undefined);
        if (typeof native.next_batch !== 'string' || !native.next_batch) throw new Error('Matrix sync has no continuation');
        break;
      } catch (error) {
        if (!overflow(error)) throw error;
        if (limit === 0) throw Object.assign(new Error('Matrix sync state exceeds the collection resource bound; unread positions are unchanged'), { code: 'limit' });
        limit = Math.floor(limit / 2);
      }
    }
    const departedRooms = Object.keys(native.rooms?.leave ?? {}), reset = new Set(departedRooms);
    const rooms: MessageFeed['rooms'] = Object.create(null);
    for (const [room, data] of Object.entries(native.rooms?.join ?? {})) {
      if (!roomId(room)) throw new Error('Invalid Matrix joined-room identity');
      const events = data.timeline?.events ?? [], state = data.state?.events ?? [];
      const own = (event: MatrixEvent) => event.type === 'm.room.member' && event.state_key === self;
      const changed = (event: MatrixEvent) => {
        if (!own(event)) return false;
        const previous = event.unsigned?.prev_content;
        return ['leave', 'ban'].includes(String(event.content.membership)) || event.content.membership === 'join'
          && previous && typeof previous === 'object' && !Array.isArray(previous) && ['leave', 'ban', 'invite', 'knock'].includes(String(previous.membership));
      };
      if (since && [...state, ...events].some(own)) {
        if (state.some(changed)) reset.add(room);
        if (!data.timeline?.limited) { if (events.some(changed)) reset.add(room); }
        else {
          let from = since;
          const visited = new Set<string>();
          for (;;) {
            const page = await history(room, { from, to: native.next_batch, direction: 'forward', limit: 100, filter: { types: ['membership'] } });
            if (page.chunk.some(changed)) reset.add(room);
            if (!page.chunk.length || page.end === native.next_batch) break;
            if (!page.end || visited.has(page.end)) throw new Error('Matrix membership history repeated a continuation');
            visited.add(page.end); from = page.end;
          }
          if (events.some(changed)) reset.add(room);
        }
      }
      rooms[room] = { events: events.map(event => messageEvent(event, room)), limited: data.timeline?.limited ?? false,
        previousCursor: data.timeline?.prev_batch ?? null, notifications: data.unread_notifications ?? null,
        readState: (data.account_data?.events ?? []).filter(event => ['m.fully_read', 'm.marked_unread'].includes(String(event.type))) };
    }
    const invitations = Object.keys(native.rooms?.invite ?? {});
    if ([...invitations, ...departedRooms].some(room => !roomId(room))) throw new Error('Invalid Matrix membership feed identity');
    return { cursor: native.next_batch, rooms, invitations, departedRooms, resetRooms: [...reset] };
  }
  async function origins(user: string, selected: readonly string[]): Promise<Record<string, RoomOrigin>> {
    let direct: unknown;
    try { direct = await client.get(API + '/user/' + segment(user) + '/account_data/m.direct'); }
    catch (error) { if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) throw error; direct = {}; }
    if (!direct || typeof direct !== 'object' || Array.isArray(direct)) throw new Error('Invalid Matrix direct-message map');
    const privateRooms = new Set<string>();
    for (const [person, ids] of Object.entries(direct)) {
      if (!userId(person) || !Array.isArray(ids) || ids.some(id => !roomId(id))) throw new Error('Invalid Matrix direct-message entry');
      for (const id of ids) privateRooms.add(id as string);
    }
    const result: Record<string, RoomOrigin> = Object.create(null);
    for (const room of selected) {
      const state = roomState(await client.get(API + '/rooms/' + segment(room) + '/state'));
      if (!state.ok) throw new Error(state.error.message);
      const name = state.value.find(event => event.type === 'm.room.name')?.content.name;
      const alias = state.value.find(event => event.type === 'm.room.canonical_alias')?.content.alias;
      result[room] = { kind: privateRooms.has(room) ? 'dm' : 'room', name: typeof name === 'string' ? name : null, alias: typeof alias === 'string' ? alias : null };
    }
    return result;
  }
  return {
    async identify() {
      const identity = await client.get<{ user_id: unknown }>(API + '/account/whoami');
      if (!userId(identity.user_id)) throw new Error('Invalid Matrix authenticated identity');
      return identity.user_id;
    },
    async joinedRooms() {
      const joined = await client.get<{ joined_rooms: unknown }>(API + '/joined_rooms');
      if (!Array.isArray(joined.joined_rooms) || joined.joined_rooms.length > 1000 || joined.joined_rooms.some(room => !roomId(room))
        || new Set(joined.joined_rooms).size !== joined.joined_rooms.length) throw new Error('Invalid or excessive Matrix joined-room list');
      return joined.joined_rooms as string[];
    },
    async joinedMembers(room) {
      const value = await client.get<{ joined: Record<string, unknown> }>(API + '/rooms/' + segment(room) + '/joined_members');
      if (!value.joined || typeof value.joined !== 'object' || Array.isArray(value.joined) || Object.keys(value.joined).some(id => !userId(id))) throw new Error('Invalid Matrix joined-member list');
      return Object.keys(value.joined);
    },
    synchronize,
    async history(room, request) {
      const page = await history(room, request);
      return { events: page.chunk.map(event => messageEvent(event, room)), start: page.start ?? null, end: page.end ?? null, requestedLimit: page.requestedLimit };
    },
    async event(room, id) {
      const event = await client.get<MatrixEvent>(API + '/rooms/' + segment(room) + '/event/' + segment(id));
      if (!eventId(id) || event.event_id !== id) throw new Error('Matrix event identity changed');
      return messageEvent(event, room);
    },
    async roomState(room) {
      const state = roomState(await client.get(API + '/rooms/' + segment(room) + '/state', {}, maximumCollectionBytes));
      if (!state.ok) throw new Error(state.error.message);
      return state.value as JsonObject[];
    },
    origins,
    async acknowledge(room, event) { await client.post(API + '/rooms/' + segment(room) + '/read_markers', { 'm.fully_read': event, 'm.read.private': event }); },
    async sendNotice(room, transaction, body) { await client.put(API + '/rooms/' + segment(room) + '/send/m.room.message/' + segment(transaction), ownerNotice(body)); },
    async thinking(room, user, enabled, timeoutMs) { await client.put(API + '/rooms/' + segment(room) + '/typing/' + segment(user), { typing: enabled, ...(enabled ? { timeout: timeoutMs } : {}) }); },
    async verifyPrivateConversation(room, owner, agent) {
      let state: ReturnType<typeof roomState>;
      try { state = roomState(await client.get(API + '/rooms/' + segment(room) + '/state')); }
      catch { return failure('unavailable', 'Backend private conversation is unavailable'); }
      if (!state.ok) return state;
      const verified = ownerConversationState(state.value, owner, agent);
      if (!verified.ok) return verified;
      if ([owner, agent].some(identity => !state.value.some(event => event.type === 'm.room.member' && event.state_key === identity && event.content.membership === 'join')))
        return failure('forbidden', 'Both participants must have joined the private conversation');
      const powers = roomPowers(state.value.find(event => event.type === 'm.room.power_levels')?.content ?? {}, agent);
      return powers.ok && powers.value.ownerLevel >= powers.value.message ? success(undefined) : failure('forbidden', 'Agent cannot send to its owner');
    },
    noticeFits: ownerNoticeFits, noticeChunks: ownerNoticeChunks,
  };
}
