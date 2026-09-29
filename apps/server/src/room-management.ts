import { actor, record, type Context, type Human } from './context.js';
import { serviceUser } from './config.js';
import { fields, roomId, text, userId } from '../../../packages/contracts/src/management.js';
import { failure, success, type Result } from '../../../packages/contracts/src/result.js';
import { nativeOk, nativeState, API, segment } from '../../../packages/matrix/src/http.js';
import { joined } from './rooms.js';
import * as queries from './data/queries.js';
import { changeGrants } from './management.js';
import { grants } from '../../../packages/contracts/src/management.js';
import type { RoomView, RoomMemberView } from '../../../packages/contracts/src/views.js';

async function administrator(ctx: Context, human: Human) {
  const current = actor(ctx, human);
  return !current.ok ? current : current.value.role !== 'administrator' ? failure('forbidden', 'Administrator required')
    : ctx.native.asUser(serviceUser(ctx.config));
}
export async function managedRooms(ctx: Context, human: Human): Promise<Result<RoomView[]>> {
  const client = await administrator(ctx, human);
  if (!client.ok) return client;
  const rooms = await joined(client.value);
  if (!rooms.ok) return rooms;
  const result: RoomView[] = [];
  for (const id of rooms.value) {
    const state = await nativeState(client.value, id);
    if (!state.ok) return state;
    if (!state.value.some(event => event.type === 'm.room.create' && event.sender === serviceUser(ctx.config))) continue;
    const name = state.value.find(event => event.type === 'm.room.name')?.content.name;
    result.push({ id, name: text(name, 255) ? name : id });
  }
  return success(result);
}
export async function createRoom(ctx: Context, human: Human, input: unknown): Promise<Result<unknown>> {
  const parsed = fields(input, ['name']);
  if (!parsed.ok) return parsed;
  if (!text(parsed.value.name, 100)) return failure('invalid', 'Supply a room name of 1–100 characters');
  const client = await administrator(ctx, human);
  if (!client.ok) return client;
  const rooms = await joined(client.value);
  if (!rooms.ok) return rooms;
  if (rooms.value.length >= 1000) return failure('limit', 'Room capacity reached');
  const created = await nativeOk(client.value, 'POST', API + '/createRoom', {
    name: parsed.value.name, preset: 'private_chat', visibility: 'private', room_version: '10', invite: [human.id],
    power_level_content_override: { users: { [serviceUser(ctx.config)]: 1000, [human.id]: 100 }, invite: 50,
      events_default: 0, state_default: 50, kick: 50, ban: 50, redact: 50 },
    initial_state: [{ type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } }],
  });
  if (!created.ok) return created;
  if (!roomId(created.value.room_id)) return failure('native', 'Invalid created room identity');
  record(ctx, human.id, human.id, created.value.room_id, 'room.create', { name: parsed.value.name });
  return success({ id: created.value.room_id, name: parsed.value.name });
}
export async function roomMembers(ctx: Context, human: Human, room: string): Promise<Result<RoomMemberView[]>> {
  const client = await administrator(ctx, human);
  if (!client.ok) return client;
  const state = await nativeState(client.value, room);
  if (!state.ok) return state;
  if (!state.value.some(event => event.type === 'm.room.create' && event.sender === serviceUser(ctx.config))) return failure('missing', 'Managed room not found');
  const result: RoomMemberView[] = [];
  for (const event of state.value) {
    const membership = event.content.membership;
    if (event.type !== 'm.room.member' || !userId(event.state_key) || membership !== 'join' && membership !== 'invite') continue;
    result.push({ id: event.state_key, name: text(event.content.displayname, 255) ? event.content.displayname : event.state_key,
      membership, removable: Boolean(queries.member(ctx.store, event.state_key) || queries.agentIdentity(ctx.store, event.state_key)) });
  }
  return success(result);
}
export async function changeRoomMember(ctx: Context, human: Human, room: string, input: unknown): Promise<Result<unknown>> {
  const parsed = fields(input, ['user', 'action']);
  if (!parsed.ok) return parsed;
  if (!userId(parsed.value.user) || !['invite', 'kick'].includes(String(parsed.value.action))) return failure('invalid', 'Invalid room membership action');
  const person = queries.member(ctx.store, parsed.value.user);
  const agent = queries.agentIdentity(ctx.store, parsed.value.user);
  if ((!person && !agent) || person?.status !== 'active' && parsed.value.action === 'invite') return failure('forbidden', 'Invite only active human members; agent admission requires an owner grant');
  if (agent && parsed.value.action === 'invite') return failure('forbidden', 'Agent admission requires an owner grant');
  const members = await roomMembers(ctx, human, room);
  if (!members.ok) return members;
  if (agent) {
    const current = grants(JSON.parse(agent.grants));
    if (!current.ok) return current;
    return changeGrants(ctx, human, agent.id, { revision: agent.revision, grants: current.value.filter(grant => grant.room !== room) });
  }
  const client = await administrator(ctx, human);
  if (!client.ok) return client;
  const result = await nativeOk(client.value, 'POST', API + '/rooms/' + segment(room) + '/' + parsed.value.action, { user_id: parsed.value.user });
  if (!result.ok) return result;
  record(ctx, human.id, person?.id ?? agent!.owner, room, 'room.' + parsed.value.action, { user: parsed.value.user });
  return success({ applied: true });
}
