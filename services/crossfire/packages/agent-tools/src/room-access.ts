import { roomAccess } from '@ctlflow/crossfire-adapter-crossfire/room-access';
import type { Profile } from '@ctlflow/crossfire-contracts/client';
import { identifier, roomId, choice, integer } from '@ctlflow/crossfire-contracts/schema/validation';
import { integerOption } from '@ctlflow/crossfire-contracts/limits';
import { option, type Arguments } from '@ctlflow/crossfire-adapter-matrix/commands';
import { failure } from '@ctlflow/crossfire-kernel/result';

export const roomOptions = {
  'invite-agent': ['room', 'agent', 'access', 'power-level'],
  'remove-agent': ['room', 'agent'],
  'agent-access': ['room', 'agent'],
} as const;
export async function runRoomCommand(profile: Profile, command: string, values: Arguments) {
  const client = roomAccess({ origin: profile.settings.homeserver, token: profile.account.access_token });
  if (command === 'directory') return client.directory(option(values, 'search') ?? '', integerOption(option(values, 'page'), 1, 1, 10000, '--page'),
    integerOption(option(values, 'page-size'), 50, 1, 100, '--page-size'));
  const room = roomId(option(values, 'room')), agent = identifier(option(values, 'agent'));
  if (!room.ok) return room; if (!agent.ok) return agent;
  if (command === 'agent-access') return client.read(agent.value, room.value);
  if (command === 'remove-agent') return client.change(agent.value, room.value, null);
  const mode = choice('read', 'reply', 'custom')(option(values, 'access') ?? 'read'), power = option(values, 'power-level');
  if (!mode.ok) return mode;
  if ((mode.value === 'custom') !== (power !== undefined)) return failure('invalid', 'Only custom access requires --power-level');
  const level = power === undefined ? null : integer(Number.MIN_SAFE_INTEGER)(Number(power));
  if (level && !level.ok) return level;
  return client.change(agent.value, room.value, { accessMode: mode.value, powerLevel: level?.value ?? null });
}
