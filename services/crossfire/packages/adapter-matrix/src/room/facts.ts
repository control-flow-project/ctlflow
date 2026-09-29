import { object, roomId, userId } from "@crossfire/contracts/validation";
import { failure, success, type Result } from "@crossfire/kernel/result";
import { API, segment } from '@crossfire/contracts/matrix';
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

function level(value: unknown, defaultValue: number): Result<number> {
  if (value === undefined) return success(defaultValue);
  return typeof value === "number" && Number.isSafeInteger(value) ? success(value) : failure("native", "Invalid native power level");
}

export async function roomFacts(client: Native, owner: string, room: string): Promise<Result<RoomFacts>> {
  const base = API + "/rooms/" + segment(room) + "/state/";
  const membership = await nativeOk(client, "GET", base + "m.room.member/" + segment(owner));
  if (!membership.ok) return membership;
  if (membership.value.membership !== "join") return failure("forbidden", "Owner is not a current room member");
  const response = await nativeOk(client, "GET", base + "m.room.power_levels");
  if (!response.ok) return response;
  const powers = response.value;
  const users = object(powers.users ?? {});
  const events = object(powers.events ?? {});
  if (!users.ok || !events.ok) return failure("native", "Invalid native power-level maps");
  const defaults = level(powers.users_default, 0);
  const ordinary = level(powers.events_default, 0);
  const state = level(powers.state_default, 50);
  if (!defaults.ok) return defaults;
  if (!ordinary.ok) return ordinary;
  if (!state.ok) return state;
  const ownerLevel = level(users.value[owner], defaults.value);
  const message = level(events.value["m.room.message"], ordinary.value);
  const reaction = level(events.value["m.reaction"], ordinary.value);
  const thresholds = [powers.invite ?? 0, powers.kick ?? 50, powers.ban ?? 50, powers.redact ?? 50,
    state.value, ...Object.entries(events.value).filter(([key]) => !["m.room.message", "m.reaction"].includes(key)).map(([, value]) => value)];
  const checked = thresholds.map(value => level(value, 0));
  if (!ownerLevel.ok) return ownerLevel;
  if (!message.ok) return message;
  if (!reaction.ok) return reaction;
  if (checked.some(value => !value.ok)) return failure("native", "Invalid native permission thresholds");
  const stateEvents = await nativeState(client, room);
  if (!stateEvents.ok) return stateEvents;
  const creation = stateEvents.value.find(event => event.type === "m.room.create" && event.state_key === "");
  if (!creation) return failure("native", "Native room creation state is missing");
  const creators = creation.content.room_version === "12" ? [creation.sender] : [];
  const additional = creation.content.additional_creators;
  if (creation.content.room_version === '12' && additional !== undefined) {
    if (!Array.isArray(additional) || !additional.every(userId)) return failure("native", "Invalid native creator identities");
    creators.push(...additional as string[]);
  }
  const ceiling = Math.min(...checked.map(value => value.ok ? value.value : 0)) - 1;
  if (!Number.isSafeInteger(ceiling)) return failure("native", "Native power ceiling cannot be represented");
  const content = (type: string, key: string) => stateEvents.value.find(event => event.type === type && event.state_key === '')?.content[key];
  const name = content('m.room.name', 'name'), topic = content('m.room.topic', 'topic'), alias = content('m.room.canonical_alias', 'alias');
  return success({ room, name: typeof name === 'string' && name ? name.slice(0, 255) : 'Unnamed room',
    topic: typeof topic === 'string' ? topic.slice(0, 4096) : '', alias: typeof alias === 'string' ? alias.slice(0, 255) : null,
    ownerLevel: ownerLevel.value, ownerCreator: creators.includes(owner), creators,
    ceiling, ordinary: ordinary.value, message: message.value, reaction: reaction.value, powers });
}
