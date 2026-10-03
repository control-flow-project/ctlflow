import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { Page, PageRequest } from '../port/directory.js';
import type { RoomFacts } from '../port/matrix-authority.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import { privateConversation } from '../owner-conversation/protect.js';
export type RoomDetails = { roomId: string; name: string; topic: string; alias: string | null; authority: RoomFacts | null };
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'clock' | 'runtime'>;
export async function readRoom(services: Dependencies, actor: Actor, roomId: string, agentId?: string): Promise<Result<RoomDetails>> {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  if (agentId) {
    const permitted = authorizeAgent(services, actor, agentId, 'read'), conversation = privateConversation(services, roomId);
    if (!permitted.ok) return permitted; if (!conversation.ok) return conversation;
    if (conversation.value && (conversation.value.kind === 'management' || conversation.value.agentId !== agentId)) return failure('forbidden', 'This private owner DM is not an agent assignment');
  }
  const native = await services.matrix.room(current.value.matrixUserId, roomId);
  if (native.ok) return success({ roomId, name: native.value.name, topic: native.value.topic, alias: native.value.alias, authority: native.value });
  if (!agentId) return native;
  const agent = authorizeAgent(services, actor, agentId, 'read');
  if (!agent.ok) return agent;
  const grant = services.repositories.agentRoomGrant.find({ agentId, roomId });
  if (!grant.ok) return grant;
  if (!grant.value) return failure('missing', 'Assigned room not found');
  const observed = await services.matrix.room(agent.value.principal.matrixUserId, roomId);
  if (!observed.ok) return success({ roomId, name: roomId, topic: '', alias: null, authority: null });
  return success({ roomId, name: observed.value.name, topic: observed.value.topic, alias: observed.value.alias, authority: null });
}
export async function listRooms(services: Dependencies, actor: Actor, input: PageRequest & { agentId?: string; search: string }): Promise<Result<Page<RoomDetails>>> {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  const joined = await services.matrix.joined(current.value.matrixUserId);
  if (!joined.ok) return joined;
  const identifiers = new Set(joined.value);
  if (input.agentId !== undefined) {
    const agent = authorizeAgent(services, actor, input.agentId, 'read');
    if (!agent.ok) return agent;
    const grants = services.collection.roomGrants({ agentId: input.agentId });
    if (!grants.ok) return grants;
    for (const grant of grants.value) identifiers.add(grant.roomId);
  }
  const rooms: RoomDetails[] = [];
  for (const roomId of [...identifiers].sort()) {
    if (input.agentId !== undefined) {
      const conversation = privateConversation(services, roomId);
      if (!conversation.ok) return conversation;
      if (conversation.value && (conversation.value.kind === 'management' || conversation.value.agentId !== input.agentId)) continue;
    }
    const found = await readRoom(services, actor, roomId, input.agentId);
    if (!found.ok) return found;
    if ([found.value.name, found.value.alias ?? '', roomId].some(value => value.toLowerCase().includes(input.search.toLowerCase()))) rooms.push(found.value);
  }
  rooms.sort((left, right) => left.name.localeCompare(right.name) || left.roomId.localeCompare(right.roomId));
  const totalItems = rooms.length;
  return success({ items: rooms.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
    page: input.page, pageSize: input.pageSize, totalItems, totalPages: Math.ceil(totalItems / input.pageSize) });
}
