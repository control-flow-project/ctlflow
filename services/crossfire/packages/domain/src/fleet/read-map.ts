import { failure, success, type Result } from '@crossfire/kernel/result';
import { FLEET_MAP_LIMITS } from '@crossfire/kernel/fleet-map';
import type { Actor, Services } from '../port/services.js';
import type { PrincipalSummary } from '../port/discovery.js';
import type { AgentRecord } from '../port/directory.js';
import type { AgentRoomGrant, RoomGrantApplication } from '../room-access/types.js';
import { readActivity, type AgentActivity } from '../listener/activity.js';
import { wakeSenderMatrixIds } from '../wake/resolve-policy.js';
import { readFleet, type FleetDetails } from './read-fleet.js';
import { readRoom } from '../room/read-room.js';

export type FleetMapAgent = { instanceKey: string; record: AgentRecord; sourceId: string; activity: AgentActivity };
export type FleetMapConnection = { agentId: string; roomId: string; grant: AgentRoomGrant | null; application: RoomGrantApplication | null };
export type FleetMapRoom = { roomId: string; name: string | null; alias: string | null };
export type FleetMapSource = { sourceId: string; mode: AgentRecord['agent']['wakeMode']; selectedPrincipalIds: string[]; eligiblePrincipalIds: string[] };
export type FleetMap = { fleet: FleetDetails; capturedAt: number; agents: FleetMapAgent[]; rooms: FleetMapRoom[];
  connections: FleetMapConnection[]; sources: FleetMapSource[]; principals: PrincipalSummary[] };
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'roomGrantRead' | 'listenerRead' | 'matrix' | 'clock' | 'identity'>;

function roomConnections(grants: AgentRoomGrant[], applications: RoomGrantApplication[]): FleetMapConnection[] {
  const byKey = new Map<string, FleetMapConnection>();
  for (const grant of grants) byKey.set(grant.agentId + '\0' + grant.roomId, { agentId: grant.agentId, roomId: grant.roomId, grant, application: null });
  for (const application of applications) {
    const key = application.agentId + '\0' + application.roomId;
    const connection = byKey.get(key) ?? { agentId: application.agentId, roomId: application.roomId, grant: null, application: null };
    connection.application = application; byKey.set(key, connection);
  }
  return [...byKey.values()].filter(({ grant, application }) => grant?.accessMode !== 'none' && grant !== null
    || application?.membership === 'join' || application?.membership === 'invite'
    || Boolean(application?.errorCode || application?.errorMessage)
    || grant !== null && application?.appliedRevision !== grant.revision)
    .sort((left, right) => left.agentId.localeCompare(right.agentId) || left.roomId.localeCompare(right.roomId));
}

export async function readFleetMap(services: Dependencies, actor: Actor, fleetId: string): Promise<Result<FleetMap>> {
  const fleet = readFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
  const capturedAt = services.clock.now();
  const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
  if (instances.value.length > FLEET_MAP_LIMITS.agents) return failure('limit', 'Fleet map exceeds the agent limit');
  const agentIds = instances.value.map(instance => instance.agentId);
  const records = services.directory.agents({ page: 1, pageSize: Math.max(1, agentIds.length), ownerId: fleet.value.ownerId,
    agentIds, statuses: ['active', 'suspended', 'revoked'], search: '' });
  if (!records.ok) return records;
  if (records.value.totalItems !== agentIds.length) return failure('unavailable', 'Fleet map has an incomplete agent directory');
  const relations = services.roomGrantRead.forAgents(agentIds); if (!relations.ok) return relations;
  const connections = roomConnections(relations.value.grants, relations.value.applications);
  if (connections.length > FLEET_MAP_LIMITS.connections) return failure('limit', 'Fleet map exceeds the connection limit');
  const roomObservers = new Map<string, FleetMapConnection>();
  for (const connection of connections) {
    const previous = roomObservers.get(connection.roomId);
    if (!previous || connection.application?.membership === 'join' && previous.application?.membership !== 'join') roomObservers.set(connection.roomId, connection);
  }
  if (roomObservers.size > FLEET_MAP_LIMITS.rooms) return failure('limit', 'Fleet map exceeds the room limit');
  const active = services.directory.activePrincipals(); if (!active.ok) return active;
  const selected = services.collection.wakeSendersForAgents(agentIds); if (!selected.ok) return selected;
  const selectedByAgent = new Map<string, typeof selected.value>();
  for (const entry of selected.value) {
    const senders = selectedByAgent.get(entry.agentId) ?? []; senders.push(entry); selectedByAgent.set(entry.agentId, senders);
  }
  const activeByMatrixId = new Map(active.value.map(value => [value.principal.matrixUserId, value.principal.id]));
  const sources = new Map<string, FleetMapSource>(), sourceByAgent = new Map<string, string>();
  const principalIds = new Set<string>();
  for (const record of records.value.items) {
    const senders = selectedByAgent.get(record.principal.id) ?? [];
    const selectedPrincipalIds = record.agent.wakeMode === 'selected' ? senders.map(sender => sender.senderPrincipalId).sort() : [];
    const sourceId = services.identity.hash(record.agent.wakeMode + '\0' + selectedPrincipalIds.join('\0'));
    const source = sources.get(sourceId) ?? { sourceId, mode: record.agent.wakeMode, selectedPrincipalIds, eligiblePrincipalIds: [] };
    const eligible = new Set(source.eligiblePrincipalIds);
    for (const matrixId of wakeSenderMatrixIds(record, active.value, senders)) eligible.add(activeByMatrixId.get(matrixId)!);
    source.eligiblePrincipalIds = [...eligible].sort(); sources.set(sourceId, source); sourceByAgent.set(record.principal.id, sourceId);
    for (const id of [...source.selectedPrincipalIds, ...source.eligiblePrincipalIds]) principalIds.add(id);
  }
  if (principalIds.size > FLEET_MAP_LIMITS.principals) return failure('limit', 'Fleet map exceeds the identity limit');
  const principals = services.discovery.selected([...principalIds]); if (!principals.ok) return principals;
  if (principals.value.length !== principalIds.size) return failure('unavailable', 'Fleet map has an incomplete identity directory');
  const activity = readActivity(services, agentIds); if (!activity.ok) return activity;
  const instanceByAgent = new Map(instances.value.map(instance => [instance.agentId, instance.instanceKey]));
  const agents = records.value.items.map(record => ({ instanceKey: instanceByAgent.get(record.principal.id)!, record,
    sourceId: sourceByAgent.get(record.principal.id)!, activity: activity.value.get(record.principal.id)! }));
  const requestedRooms = [...roomObservers.values()].sort((left, right) => left.roomId.localeCompare(right.roomId));
  const rooms: FleetMapRoom[] = new Array(requestedRooms.length);
  let cursor = 0;
  async function labels() {
    while (cursor < requestedRooms.length) {
      const index = cursor++, { roomId, agentId } = requestedRooms[index]!;
      const result = await readRoom(services, actor, roomId, agentId);
      rooms[index] = result.ok ? { roomId, name: result.value.name === roomId ? null : result.value.name, alias: result.value.alias }
        : { roomId, name: null, alias: null };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, requestedRooms.length) }, () => labels()));
  const stillAuthorized = readFleet(services, actor, fleetId); if (!stillAuthorized.ok) return stillAuthorized;
  return success({ fleet: fleet.value, capturedAt, agents, rooms, connections, sources: [...sources.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId)), principals: principals.value });
}
