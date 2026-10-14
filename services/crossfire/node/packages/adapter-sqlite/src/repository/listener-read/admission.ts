import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapListenerRun } from '../listener-run/map.js';

export function readAdmissionCandidates(database: Database.Database, agentIds: string[], since: number) {
  if (!agentIds.length) return [];
  const rows = executeSelect(database, schema, (query, params) => query.from('listener_run')
    .where(run => params.agentIds.includes(run.agent_id) && run.stopped_at === null && run.last_seen_at > params.since)
    .join(query.from('fleet_instance'), run => run.agent_id, binding => binding.agent_id, (run, binding) => ({ run, binding }))
    .join(query.from('fleet')
      .join(query.from('principal'), fleet => fleet.owner_id, owner => owner.id, (fleet, owner) => ({ fleet, owner }))
      .select(row => ({ id: row.fleet.id, owner_id: row.fleet.owner_id, fleet_key: row.fleet.fleet_key,
        archived_at: row.fleet.archived_at, delivery_enabled: row.fleet.delivery_enabled, owner_status: row.owner.status })),
      row => row.run.controller_fleet_id, fleet => fleet.id, (row, fleet) => ({ ...row, fleet }))
    .join(query.from('fleet_connection'), row => row.run.controller_fleet_id, connection => connection.fleet_id, (row, connection) => ({ ...row, connection }))
    .join(query.from('fleet_credential'), row => row.run.controller_credential_id, credential => credential.id, (row, credential) => ({ ...row, credential }))
    .orderBy(row => row.run.agent_id).thenByDescending(row => row.run.last_seen_at).thenBy(row => row.run.id)
    .select(row => ({ id: row.run.id, agent_id: row.run.agent_id, release: row.run.release,
      controller_fleet_id: row.run.controller_fleet_id, controller_connection_id: row.run.controller_connection_id,
      controller_credential_id: row.run.controller_credential_id, started_at: row.run.started_at, last_seen_at: row.run.last_seen_at,
      active_ms: row.run.active_ms, messages_delivered: row.run.messages_delivered,
      stopped_at: row.run.stopped_at, disconnect_requested_at: row.run.disconnect_requested_at,
      bindingOwnerId: row.binding.owner_id, bindingFleetKey: row.binding.fleet_key, retiredAt: row.binding.retired_at,
      fleetId: row.fleet.id, fleetOwnerId: row.fleet.owner_id, fleetKey: row.fleet.fleet_key,
      archivedAt: row.fleet.archived_at, deliveryEnabled: row.fleet.delivery_enabled,
      connectionId: row.connection.connection_id, credentialId: row.connection.credential_id,
      closedAt: row.connection.closed_at, expiresAt: row.connection.expires_at,
      credentialFleetId: row.credential.fleet_id, revokedAt: row.credential.revoked_at, ownerStatus: row.fleet.owner_status })), { agentIds, since });
  return rows.map(row => ({ run: mapListenerRun(row), facts: {
    binding: { ownerId: row.bindingOwnerId, fleetKey: row.bindingFleetKey, retiredAt: row.retiredAt },
    fleet: { id: row.fleetId, ownerId: row.fleetOwnerId, fleetKey: row.fleetKey, archivedAt: row.archivedAt, deliveryEnabled: row.deliveryEnabled === 1 },
    connection: { connectionId: row.connectionId, credentialId: row.credentialId, closedAt: row.closedAt, expiresAt: row.expiresAt },
    credential: { fleetId: row.credentialFleetId, revokedAt: row.revokedAt }, ownerStatus: row.ownerStatus,
  } }));
}
