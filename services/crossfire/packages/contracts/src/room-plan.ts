import { parse } from 'smol-toml';
import * as check from './schema/validation.js';
import { plan } from './schema/request.js';
import { failure } from '@crossfire/kernel/result';

const grant = check.object({ room: check.roomId, access: check.choice('read', 'reply', 'custom'), muted: check.boolean,
  level: check.optional(check.integer(Number.MIN_SAFE_INTEGER)) });
const document = check.object({ fleet: check.name, agents: check.list(check.object({ instance: check.name, grants: check.list(grant, 100) }), 100, 1) });
export function parseRoomPlan(source: string, fleet: { fleetId: string; fleetKey: string }) {
  if (new TextEncoder().encode(source).length > 1024 * 1024) return failure('limit', 'Room plan exceeds 1 MiB');
  try {
    const input = document(parse(source, { integersAsBigInt: 'asNeeded' }));
    if (!input.ok) return input;
    if (input.value.fleet !== fleet.fleetKey) return failure('invalid', 'The room plan must identify the selected fleet');
    if (input.value.agents.some(agent => agent.grants.some(grant => (grant.access === 'custom') !== (grant.level !== undefined)))) return failure('invalid', 'Only custom access requires a level');
    return plan({ fleetId: fleet.fleetId, agents: input.value.agents.map(agent => ({ instanceKey: agent.instance,
      grants: agent.grants.map(grant => ({ roomId: grant.room, accessMode: grant.access, powerLevel: grant.level ?? null, muted: grant.muted })) })) });
  } catch { return failure('invalid', 'Invalid TOML room plan'); }
}
