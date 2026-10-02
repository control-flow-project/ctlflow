import { object, userId } from './validation.js';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { JsonObject } from './json.js';

export type RoomStateEvent = { sender: string; type: string; state_key: string; content: JsonObject };
export type RoomPowers = { ownerLevel: number; ceiling: number; ordinary: number; message: number; reaction: number };

export function roomState(input: unknown): Result<RoomStateEvent[]> {
  if (!Array.isArray(input)) return failure('native', 'Native room state could not be read');
  const events: RoomStateEvent[] = [];
  for (const value of input) {
    const parsed = object(value);
    if (!parsed.ok) return failure('native', 'Invalid native state event');
    const event = parsed.value;
    const content = object(event.content);
    if (typeof event.sender !== 'string' || typeof event.type !== 'string' || typeof event.state_key !== 'string' || !content.ok) {
      return failure('native', 'Invalid native state identity');
    }
    events.push({ sender: event.sender, type: event.type, state_key: event.state_key, content: event.content as JsonObject });
  }
  return success(events);
}

function level(value: unknown, defaultValue: number): Result<number> {
  if (value === undefined) return success(defaultValue);
  return typeof value === 'number' && Number.isSafeInteger(value) ? success(value) : failure('native', 'Invalid native power level');
}

export function roomCreators(events: readonly RoomStateEvent[]): Result<string[]> {
  const creation = events.find(event => event.type === 'm.room.create' && event.state_key === '');
  if (!creation || !userId(creation.sender)) return failure('native', 'Native room creation state is missing or invalid');
  if (creation.content.room_version !== '12') return success([]);
  const additional = creation.content.additional_creators ?? [];
  if (!Array.isArray(additional) || !additional.every(userId)) return failure('native', 'Invalid native creator identities');
  return success([...new Set([creation.sender, ...additional as string[]])]);
}

export function roomPowers(powers: JsonObject, owner: string): Result<RoomPowers> {
  const users = object(powers.users ?? {});
  const events = object(powers.events ?? {});
  if (!users.ok || !events.ok) return failure('native', 'Invalid native power-level maps');
  const defaults = level(powers.users_default, 0);
  const ordinary = level(powers.events_default, 0);
  const state = level(powers.state_default, 50);
  if (!defaults.ok) return defaults;
  if (!ordinary.ok) return ordinary;
  if (!state.ok) return state;
  const ownerLevel = level(users.value[owner], defaults.value);
  const message = level(events.value['m.room.message'], ordinary.value);
  const reaction = level(events.value['m.reaction'], ordinary.value);
  const thresholds = [powers.invite ?? 0, powers.kick ?? 50, powers.ban ?? 50, powers.redact ?? 50,
    state.value, ...Object.entries(events.value).filter(([key]) => !['m.room.message', 'm.reaction'].includes(key)).map(([, value]) => value)];
  const checked = thresholds.map(value => level(value, 0));
  if (!ownerLevel.ok) return ownerLevel;
  if (!message.ok) return message;
  if (!reaction.ok) return reaction;
  if (checked.some(value => !value.ok)) return failure('native', 'Invalid native permission thresholds');
  const ceiling = Math.min(...checked.map(value => value.ok ? value.value : 0)) - 1;
  if (!Number.isSafeInteger(ceiling)) return failure('native', 'Native power ceiling cannot be represented');
  return success({ ownerLevel: ownerLevel.value, ceiling, ordinary: ordinary.value, message: message.value, reaction: reaction.value });
}
