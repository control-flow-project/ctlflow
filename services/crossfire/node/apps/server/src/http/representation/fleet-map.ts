import type { FleetMap } from '@ctlflow/crossfire-domain/fleet/read-map';
import { agentDisplayName } from '@ctlflow/crossfire-domain/identity/display-name';
import { fleet } from './enrollment.js';
import { grant, application } from './room.js';
export function fleetMap(value: FleetMap) {
  return { fleet: fleet(value.fleet), capturedAt: value.capturedAt, sources: value.sources, principals: value.principals, rooms: value.rooms,
    agents: value.agents.map(({ record, sourceId, instanceKey, activity }) => ({ agentId: record.principal.id, backendUserId: record.principal.backendUserId,
      instanceKey, displayName: agentDisplayName(record.name, record.ownerMember.displayName),
      status: record.principal.status, owner: { memberId: record.owner.id, backendUserId: record.owner.backendUserId,
        displayName: record.ownerMember.displayName, status: record.owner.status }, sourceId, listener: activity.status, lastSeenAt: activity.lastSeenAt })),
    connections: value.connections.map(connection => ({ agentId: connection.agentId, roomId: connection.roomId,
      grant: connection.grant ? grant(connection.grant) : null, application: connection.application ? application(connection.application) : null })) };
}
