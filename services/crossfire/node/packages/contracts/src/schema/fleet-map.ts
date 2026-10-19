import { FLEET_MAP_LIMITS } from '@ctlflow/crossfire-kernel/fleet-map';
import * as check from './validation.js';
import { fleet, grant, grantApplication, principal, owner } from './response.js';
import type { Parsed } from './validation.js';
import { wakeSelection } from './request.js';

export const mapAgent = check.object({ agentId: check.identifier, backendUserId: check.backendUserId, instanceKey: check.name,
  displayName: check.text(255), status: check.status, owner, sourceId: check.text(64, 64),
  listener: check.choice('online', 'offline', 'disconnecting'), lastSeenAt: check.nullable(check.integer()) });
export const mapRoom = check.object({ roomId: check.roomId, name: check.nullable(check.text(255)), alias: check.nullable(check.text(255)) });
export const mapConnection = check.object({ agentId: check.identifier, roomId: check.roomId, grant: check.nullable(grant), application: check.nullable(grantApplication) });
export const mapSource = check.object({ sourceId: check.text(64, 64), mode: check.wakeMode,
  senders: check.list(wakeSelection, FLEET_MAP_LIMITS.principals), eligiblePrincipalIds: check.list(check.identifier, FLEET_MAP_LIMITS.principals) });
export const fleetMap = check.refine(check.object({ fleet, capturedAt: check.integer(), agents: check.list(mapAgent, FLEET_MAP_LIMITS.agents),
  rooms: check.list(mapRoom, FLEET_MAP_LIMITS.rooms), connections: check.list(mapConnection, FLEET_MAP_LIMITS.connections),
  sources: check.list(mapSource, FLEET_MAP_LIMITS.agents), principals: check.list(principal, FLEET_MAP_LIMITS.principals) }), value => {
  const agents = new Set(value.agents.map(agent => agent.agentId)), rooms = new Set(value.rooms.map(room => room.roomId));
  const sources = new Set(value.sources.map(source => source.sourceId)), principals = new Set(value.principals.map(identity => identity.principalId));
  return agents.size === value.agents.length && rooms.size === value.rooms.length && sources.size === value.sources.length && principals.size === value.principals.length
    && value.agents.every(agent => sources.has(agent.sourceId) && agent.owner.memberId === value.fleet.owner.principalId)
    && value.sources.every(source => [...source.senders.map(sender => sender.principalId), ...source.eligiblePrincipalIds].every(id => principals.has(id))
      && new Set(source.senders.map(sender => sender.principalId)).size === source.senders.length && new Set(source.eligiblePrincipalIds).size === source.eligiblePrincipalIds.length
      && source.senders.every(sender => !sender.includeAgents || value.principals.some(identity => identity.principalId === sender.principalId && identity.kind === 'human'))
      && (source.mode !== 'everyone' || source.senders.length === 0)
      && value.agents.some(agent => agent.sourceId === source.sourceId))
    && new Set(value.connections.map(connection => connection.agentId + '\0' + connection.roomId)).size === value.connections.length
    && value.connections.every(connection => agents.has(connection.agentId) && rooms.has(connection.roomId)
      && (connection.grant !== null || connection.application !== null)
      && (connection.grant === null || connection.grant.agentId === connection.agentId && connection.grant.roomId === connection.roomId))
    && value.rooms.every(room => value.connections.some(connection => connection.roomId === room.roomId));
}, 'Fleet map contains duplicate or disconnected identities');
export type FleetMapView = Parsed<typeof fleetMap>;
export type MapAgent = Parsed<typeof mapAgent>;
export type MapConnection = Parsed<typeof mapConnection>;
export type MapSource = Parsed<typeof mapSource>;
