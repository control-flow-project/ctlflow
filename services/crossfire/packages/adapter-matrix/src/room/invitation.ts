import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { RoomInvitation } from '@ctlflow/crossfire-domain/port/messaging';
import { API, segment } from '../protocol.js';
import { userId } from '../syntax.js';
import { object, roomId as validRoomId } from '@ctlflow/crossfire-contracts/validation';
import { eventId } from '@ctlflow/crossfire-contracts/schema/validation';
import { nativeOk, nativeJson, type Native } from '../http.js';

type InvitationState = { since: string; senders: Map<string, string> };
const filter = { room: { timeline: { limit: 0 }, state: { types: ['m.room.member'] },
  ephemeral: { types: [] }, account_data: { types: [] } }, presence: { types: [] }, account_data: { types: [] } };

function invitationUpdates(input: unknown, backendUserId: string): Result<Map<string, string>> {
  const invites = object(input ?? {});
  if (!invites.ok || Object.keys(invites.value).length > 1000) return failure('native', 'Invalid native invitations');
  const senders = new Map<string, string>();
  for (const [roomId, raw] of Object.entries(invites.value)) {
    if (!validRoomId(roomId)) return failure('native', 'Invalid native invitation room identity');
    const invited = object(raw);
    const state = invited.ok ? object(invited.value.invite_state) : invited;
    if (!state.ok || !Array.isArray(state.value.events) || state.value.events.length > 1000) return failure('native', 'Invalid native invitation state');
    for (const raw of state.value.events) {
      const event = object(raw);
      if (!event.ok) return failure('native', 'Invalid native invitation event');
      if (event.value.type !== 'm.room.member' || event.value.state_key !== backendUserId) continue;
      const content = object(event.value.content);
      if (!content.ok || content.value.membership !== 'invite' || !userId(event.value.sender)) return failure('native', 'Invalid native invitation author');
      senders.set(roomId, event.value.sender);
    }
    if (!senders.has(roomId)) return failure('native', 'Native invitation has no recipient membership');
  }
  return success(senders);
}

async function synchronizeInvitations(client: Native, backendUserId: string, state?: InvitationState): Promise<Result<InvitationState>> {
  const response = await nativeOk(client, 'GET', API + '/sync?timeout=0&filter=' + segment(JSON.stringify(filter))
    + (state ? '&since=' + segment(state.since) : ''));
  if (!response.ok) return response;
  const rooms = object(response.value.rooms ?? {});
  if (!rooms.ok || typeof response.value.next_batch !== 'string' || !response.value.next_batch.length
    || response.value.next_batch.length > 1024) return failure('native', 'Invalid native invitation synchronization');
  const invited = invitationUpdates(rooms.value.invite, backendUserId);
  const joined = object(rooms.value.join ?? {}), left = object(rooms.value.leave ?? {});
  if (!invited.ok) return invited;
  if (!joined.ok || !left.ok) return failure('native', 'Invalid native invitation membership updates');
  const senders = new Map(state?.senders);
  for (const [id, sender] of invited.value) senders.set(id, sender);
  for (const id of [...Object.keys(joined.value), ...Object.keys(left.value)]) senders.delete(id);
  if (senders.size > 1000) return failure('native', 'Native pending invitations exceed the room limit');
  return success({ since: response.value.next_batch, senders });
}

export function createInvitationReader() {
  const states = new Map<string, InvitationState>();
  const operations = new Map<string, Promise<void>>();
  return async (client: Native, backendUserId: string): Promise<Result<ReadonlyMap<string, string>>> => {
    const previous = operations.get(backendUserId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    operations.set(backendUserId, current);
    await previous;
    try {
      let state = states.get(backendUserId);
      if (!state) {
        const initial = await synchronizeInvitations(client, backendUserId);
        if (!initial.ok) return initial;
        state = initial.value;
        states.set(backendUserId, state);
      }
      const incremental = await synchronizeInvitations(client, backendUserId, state);
      if (!incremental.ok) return incremental;
      states.set(backendUserId, incremental.value);
      return success(new Map(incremental.value.senders));
    } finally {
      release();
      if (operations.get(backendUserId) === current) operations.delete(backendUserId);
    }
  };
}

export async function invitationEvent(client: Native, backendUserId: string, roomId: string, senderBackendUserId: string): Promise<Result<RoomInvitation | null>> {
  const response = await nativeJson(client, 'GET', API + '/rooms/' + segment(roomId) + '/state');
  if (!response.ok) return response;
  if (response.value.status !== 200 || !Array.isArray(response.value.body) || response.value.body.length > 1000) return failure('native', 'Native invitation could not be verified');
  for (const raw of response.value.body) {
    const event = object(raw);
    if (!event.ok) return failure('native', 'Invalid native membership event');
    if (event.value.type !== 'm.room.member' || event.value.state_key !== backendUserId) continue;
    const content = object(event.value.content);
    if (!content.ok) return failure('native', 'Invalid native membership content');
    if (content.value.membership !== 'invite' || event.value.sender !== senderBackendUserId) return success(null);
    const identifier = eventId(event.value.event_id);
    if (!identifier.ok) return failure('native', 'Invalid native invitation identity');
    if (content.value.is_direct !== undefined && typeof content.value.is_direct !== 'boolean') return failure('native', 'Invalid native direct invitation');
    return success({ roomId, eventId: identifier.value, senderBackendUserId, direct: content.value.is_direct === true });
  }
  return success(null);
}
