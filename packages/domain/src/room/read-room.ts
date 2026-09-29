import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import type { Page, PageRequest } from '../port/directory.js';
import type { RoomFacts } from '../port/matrix-authority.js';
import { activeActor, authorize, authorizeAgent } from '../authorization/authorize.js';
export type RoomDetails = { roomId: string; name: string; topic: string; alias: string | null; authority: RoomFacts | null };
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'matrix' | 'clock'>;
export async function readRoom(services: Dependencies, actor: Actor, roomId: string, agentId?: string): Promise<Result<RoomDetails>> {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
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
    const found = await readRoom(services, actor, roomId, input.agentId);
    if (!found.ok) return found;
    if ([found.value.name, found.value.alias ?? '', roomId].some(value => value.toLowerCase().includes(input.search.toLowerCase()))) rooms.push(found.value);
  }
  rooms.sort((left, right) => left.name.localeCompare(right.name) || left.roomId.localeCompare(right.roomId));
  const totalItems = rooms.length;
  return success({ items: rooms.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
    page: input.page, pageSize: input.pageSize, totalItems, totalPages: Math.ceil(totalItems / input.pageSize) });
}
export async function listRoomMembers(services: Dependencies, actor: Actor, roomId: string, input: PageRequest) {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  const native = await services.matrix.members(current.value.matrixUserId, roomId);
  if (!native.ok) return native;
  const rows = [...native.value].sort((left, right) => left.matrixUserId.localeCompare(right.matrixUserId));
  return success({ items: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize), page: input.page,
    pageSize: input.pageSize, totalItems: rows.length, totalPages: Math.ceil(rows.length / input.pageSize) });
}
export async function createRoom(services: Dependencies, actor: Actor, name: string) {
  const current = authorize(services, actor, 'room.manage.native');
  return current.ok ? services.matrix.createRoom(current.value.matrixUserId, name) : current;
}
