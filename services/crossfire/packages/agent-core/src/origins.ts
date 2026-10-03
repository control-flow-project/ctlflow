import { API, segment } from '@crossfire/contracts/matrix';
import { roomState } from '@crossfire/contracts/matrix-room';
import { roomId, userId } from '@crossfire/contracts/validation';
import type { Matrix } from './port.js';
import type { ReceivedEvent } from './receive.js';

export async function eventOrigins(client: Matrix, self: string, events: readonly ReceivedEvent[]): Promise<ReceivedEvent[]> {
  let direct: unknown;
  try { direct = await client.get(API + '/user/' + segment(self) + '/account_data/m.direct'); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) throw error;
    direct = {};
  }
  if (!direct || typeof direct !== 'object' || Array.isArray(direct)) throw new Error('Invalid native direct-message map');
  const rooms = new Set<string>();
  for (const [person, ids] of Object.entries(direct)) {
    if (!userId(person) || !Array.isArray(ids) || ids.some(id => !roomId(id))) throw new Error('Invalid native direct-message entry');
    for (const id of ids) rooms.add(id as string);
  }
  const origins = new Map<string, ReceivedEvent['origin']>();
  for (const room of new Set(events.map(event => event.room_id))) {
    const state = roomState(await client.get(API + '/rooms/' + segment(room) + '/state'));
    if (!state.ok) throw new Error(state.error.message);
    const name = state.value.find(event => event.type === 'm.room.name')?.content.name;
    const alias = state.value.find(event => event.type === 'm.room.canonical_alias')?.content.alias;
    origins.set(room, { kind: rooms.has(room) ? 'dm' : 'room', name: typeof name === 'string' ? name : null,
      alias: typeof alias === 'string' ? alias : null });
  }
  return events.map(event => ({ ...event, origin: origins.get(event.room_id)! }));
}
