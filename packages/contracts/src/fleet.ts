import { UUID, profileName } from './client.js';
import { fields, text, userId } from './management.js';
import { failure, success, type Result } from '../../kernel/src/result.js';

export const FLEET_LIMIT = 100;
export type FleetEntry = { key: string; name: string; identity?: { id: string; token: string } };
export type FleetRoster = { owner: string; fleet: string; instances: FleetEntry[] };
export type FleetIntroduction = FleetRoster & { requestId: string; secret: string };
export type FleetOutcome = { key: string; name: string; agent: string | null; enrollment: string | null;
  status: 'existing' | 'claimed' | 'collision' | 'capacity'; error: string | null };

export function fleetRoster(value: unknown, introduction = false): Result<FleetRoster> {
  const parsed = fields(value, ['owner', 'fleet', 'instances', ...(introduction ? ['requestId', 'secret'] : [])]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!userId(input.owner) || !profileName(input.fleet) || !Array.isArray(input.instances)
    || input.instances.length < 1 || input.instances.length > FLEET_LIMIT) return failure('invalid', 'Supply an owner, fleet key and 1..100 instances');
  const instances: FleetEntry[] = [], keys = new Set<string>(), names = new Set<string>();
  for (const candidate of input.instances) {
    const entry = fields(candidate, ['key', 'name'], ['identity']);
    if (!entry.ok) return entry;
    const data = entry.value;
    if (!profileName(data.key) || !profileName(data.name) || keys.has(data.key) || names.has(data.name)) return failure('invalid', 'Fleet keys and registered names must be unique lowercase identifiers');
    keys.add(data.key); names.add(data.name);
    let identity: FleetEntry['identity'];
    if (data.identity !== undefined) {
      const supplied = fields(data.identity, ['id', 'token']);
      if (!supplied.ok) return supplied;
      if (typeof supplied.value.id !== 'string' || !UUID.test(supplied.value.id) || !text(supplied.value.token, 8192)) return failure('invalid', 'Invalid private identity proof');
      identity = { id: supplied.value.id, token: supplied.value.token };
    }
    instances.push({ key: data.key, name: data.name, ...(identity ? { identity } : {}) });
  }
  return success({ owner: input.owner, fleet: input.fleet, instances });
}

export function fleetIntroduction(value: unknown): Result<FleetIntroduction> {
  const roster = fleetRoster(value, true);
  if (!roster.ok) return roster;
  const input = value as Record<string, unknown>;
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId) || typeof input.secret !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(input.secret)) return failure('invalid', 'Persist a private request UUID and 32-byte claim before introduction');
  return success({ ...roster.value, requestId: input.requestId, secret: input.secret });
}
