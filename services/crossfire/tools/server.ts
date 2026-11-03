import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { withHuman, operatorClient, type Credentials } from './auth.js';
import { collectPages } from '@ctlflow/crossfire-operator-support/collections';

export const serverExpectations = check.object({ release: check.optional(check.text(200)), agents: check.optional(check.integer(0, 1000)),
  names: check.optional(check.list(check.name, 1000)), online: check.optional(check.boolean), emptyRooms: check.optional(check.boolean),
  fleetKey: check.optional(check.name), controllerName: check.optional(check.text(100)) });
export type Expectations = check.Parsed<typeof serverExpectations>;

export async function verifyServer(origin: string, account: Credentials, expected: Expectations, signal: AbortSignal): Promise<Result<unknown>> {
  const publicClient = operatorClient({ origin, signal });
  const health = await publicClient.call(operations.health, {}, {}); if (!health.ok) return health;
  if (expected.release && expected.release !== health.value.data.release) return failure('conflict', 'Unexpected server release');
  const denied = await publicClient.call(operations.fleets, {}, {});
  if (denied.ok || denied.error.code !== 'unauthorized') return failure('native', 'Unauthenticated fleet access was not refused');
  return withHuman(origin, account, signal, async human => {
    const agents = await collectPages(query => human.client.call(operations.agents, {}, {}, query), agent => agent.agentId); if (!agents.ok) return agents;
    const fleets = await collectPages(query => human.client.call(operations.fleets, {}, {}, query), fleet => fleet.fleetId); if (!fleets.ok) return fleets;
    if (expected.agents !== undefined && agents.value.length !== expected.agents) return failure('conflict', 'Agent count differs from expected visible roster');
    if (expected.names && JSON.stringify(agents.value.map(agent => agent.name).sort()) !== JSON.stringify([...expected.names].sort())) return failure('conflict', 'Visible roster names differ from expected exact set');
    if (expected.online && agents.value.some(agent => agent.activity.status !== 'online' || agent.activity.activeRuns.length !== 1)) return failure('conflict', 'A visible agent is not reporting exactly one live listener');
    if (expected.fleetKey && !fleets.value.some(fleet => fleet.fleetKey === expected.fleetKey && (!expected.controllerName || fleet.controller.name === expected.controllerName))) return failure('conflict', 'Expected named fleet/controller is not visible');
    const instances = [];
    for (const agent of agents.value) {
      const observations = await human.client.call(operations.runtimeObservations, { agentId: agent.agentId }, {}); if (!observations.ok) return observations;
      if (expected.online && (observations.value.data.length === 0 || observations.value.data.some(value => value.state === 'failed' || value.state === 'unavailable'))) return failure('conflict', 'A live listener lacks available native runtime observations');
      if (expected.release && agent.activity.activeRuns.some(run => run.release !== expected.release)) return failure('conflict', 'A live listener is running a different release');
      const grants = await collectPages(query => human.client.call(operations.grants, { agentId: agent.agentId }, {}, query), grant => grant.grant?.roomId ?? ''); if (!grants.ok) return grants;
      if (expected.emptyRooms && grants.value.some(grant => grant.grant?.accessMode !== 'none')) return failure('conflict', 'An agent has unexpected assigned room access');
      const found = await human.messaging.verifyProfile(agent.backendUserId, agent.displayName);
      if (!found.ok) return found;
      instances.push({ agentId: agent.agentId, name: agent.name, listener: agent.activity.status,
        installedReleases: agent.activity.activeRuns.map(run => run.release), runtime: observations.value.data, roomGrants: grants.value.length });
    }
    if (expected.emptyRooms) {
      const joined = await human.messaging.joinedRooms();
      if (!joined.ok) return joined;
      if (joined.value.length) return failure('conflict', 'Human has unexpected joined rooms');
    }
    const maps = [];
    for (const fleet of fleets.value) {
      const map = await human.client.call(operations.fleetMap, { fleetId: fleet.fleetId }, {}); if (!map.ok) return map;
      maps.push({ fleetId: fleet.fleetId, fleetKey: fleet.fleetKey, controllerName: fleet.controller.name,
        agents: map.value.data.agents.length, rooms: map.value.data.rooms.length, connections: map.value.data.connections.length });
      if (expected.emptyRooms && map.value.data.rooms.length) return failure('conflict', 'Fleet map has unexpected room memberships');
    }
    return success({ origin, release: health.value.data.release, human: human.viewer.member.backendUserId,
      role: human.viewer.member.roleCode, agents: instances, fleets: maps, checkedAt: new Date().toISOString(), modelCalls: 0 });
  });
}
