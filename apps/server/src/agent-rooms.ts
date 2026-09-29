import { object } from '../../../packages/contracts/src/management.js';
import type { AgentRoomView } from '../../../packages/contracts/src/views.js';
import { failure, success, type Result } from '../../../packages/kernel/src/result.js';
import { agentRecord, type Context, type Human } from './context.js';
import { eligible, grantLevel, roomFacts, joined, type RoomFacts } from './rooms.js';

function view(facts: RoomFacts): Result<AgentRoomView> {
  const read = grantLevel(facts, { room: facts.room, access: 'read', muted: false });
  if (!read.ok) return read;
  const reply = grantLevel(facts, { room: facts.room, access: 'reply', muted: false });
  const events = object(facts.powers.events ?? {});
  if (!events.ok) return events;
  const permissions = [
    { action: 'Send messages', level: facts.message }, { action: 'Send reactions', level: facts.reaction },
    { action: 'Other events', level: facts.ordinary },
    ...[['invite', 0], ['kick', 50], ['ban', 50], ['redact', 50], ['state_default', 50]].map(([action, fallback]) => ({
      action: String(action), level: Number(facts.powers[String(action)] ?? fallback),
    })),
    ...Object.entries(events.value).filter(([action]) => !['m.room.message', 'm.reaction'].includes(action))
      .map(([action, level]) => ({ action, level: Number(level) })),
  ];
  return success({ id: facts.room, name: facts.name, topic: facts.topic, alias: facts.alias,
    ownerLevel: facts.ownerLevel, ownerCreator: facts.ownerCreator, readLevel: read.value,
    replyLevel: reply.ok ? reply.value : null, permissions });
}

export async function agentRooms(ctx: Context, human: Human, agent: string): Promise<Result<AgentRoomView[]>> {
  const found = agentRecord(ctx, human, agent);
  if (!found.ok) return found;
  const rooms = await eligible(ctx, found.value.owner);
  if (!rooms.ok) return rooms;
  const result: AgentRoomView[] = [];
  for (const room of rooms.value) {
    const parsed = view(room);
    if (!parsed.ok) return parsed;
    result.push(parsed.value);
  }
  return success(result);
}

export async function agentRoom(ctx: Context, human: Human, agent: string, room: string): Promise<Result<AgentRoomView>> {
  const found = agentRecord(ctx, human, agent);
  if (!found.ok) return found;
  const client = await ctx.native.asUser(found.value.owner);
  if (!client.ok) return client;
  const rooms = await joined(client.value);
  if (!rooms.ok) return rooms;
  if (!rooms.value.includes(room)) return failure('missing', 'Room is outside the owner’s current access');
  const facts = await roomFacts(client.value, found.value.owner, room);
  return facts.ok ? view(facts.value) : facts;
}
