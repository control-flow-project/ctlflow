import { roomId } from "@crossfire/contracts/validation";
import { roomCreators, roomPowers } from '@crossfire/contracts/matrix-room';
import { failure, success, type Result } from "@crossfire/kernel/result";
import { API } from '@crossfire/contracts/matrix';
import { nativeOk, nativeState, type Native } from "../http.js";
import type { JsonObject } from "@crossfire/contracts/json";

export type RoomFacts = { room: string; name: string; topic: string; alias: string | null; ownerLevel: number; ownerCreator: boolean; creators: string[]; ceiling: number; ordinary: number; message: number; reaction: number; powers: JsonObject };

export async function joined(client: Native): Promise<Result<string[]>> {
  const response = await nativeOk(client, "GET", API + "/joined_rooms");
  if (!response.ok) return response;
  const rooms = response.value.joined_rooms;
  if (!Array.isArray(rooms) || rooms.length > 1000 || !rooms.every(roomId)) return failure("native", "Invalid native joined rooms");
  return success(rooms as string[]);
}

export async function roomFacts(client: Native, owner: string, room: string): Promise<Result<RoomFacts>> {
  const stateEvents = await nativeState(client, room);
  if (!stateEvents.ok) return stateEvents;
  if (stateEvents.value.find(event => event.type === 'm.room.member' && event.state_key === owner)?.content.membership !== 'join') {
    return failure('forbidden', 'Owner is not a current room member');
  }
  const powers = stateEvents.value.find(event => event.type === 'm.room.power_levels' && event.state_key === '')?.content;
  if (!powers) return failure('native', 'Native room power levels are missing');
  const levels = roomPowers(powers, owner);
  if (!levels.ok) return levels;
  const creators = roomCreators(stateEvents.value);
  if (!creators.ok) return creators;
  const content = (type: string, key: string) => stateEvents.value.find(event => event.type === type && event.state_key === '')?.content[key];
  const name = content('m.room.name', 'name'), topic = content('m.room.topic', 'topic'), alias = content('m.room.canonical_alias', 'alias');
  return success({ room, name: typeof name === 'string' && name ? name.slice(0, 255) : 'Unnamed room',
    topic: typeof topic === 'string' ? topic.slice(0, 4096) : '', alias: typeof alias === 'string' ? alias.slice(0, 255) : null,
    ...levels.value, ownerCreator: creators.value.includes(owner), creators: creators.value, powers });
}
