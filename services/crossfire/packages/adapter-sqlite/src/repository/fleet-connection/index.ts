import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { success } from '@crossfire/kernel/result';
import type { FleetConnection, FleetConnectionRepository } from '@crossfire/domain/fleet/control-types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';

function mapConnection(row: Tables['fleet_connection']): FleetConnection {
  return { fleetId: row.fleet_id, connectionId: row.connection_id, credentialId: row.credential_id,
    lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, closedAt: row.closed_at };
}
export function createFleetConnectionRepository(database: Database.Database): FleetConnectionRepository {
  return {
    find(fleetId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_connection').where(row => row.fleet_id === params.fleetId).firstOrDefault(), { fleetId });
      return success(row ? mapConnection(row) : null);
    }); },
    findMany(fleetIds) { return stored(() => success(fleetIds.length ? executeSelect(database, schema, (query, params) => query.from('fleet_connection')
      .where(row => params.fleetIds.includes(row.fleet_id)), { fleetIds }).map(mapConnection) : [])); },
    save(connection) { return stored(() => {
      const previous = executeSelect(database, schema, (query, params) => query.from('fleet_connection').where(row => row.fleet_id === params.fleetId).firstOrDefault(), connection);
      if (previous) executeUpdate(database, schema, (query, params) => query.update('fleet_connection').set({ connection_id: params.connectionId,
        credential_id: params.credentialId, last_seen_at: params.lastSeenAt, expires_at: params.expiresAt, closed_at: params.closedAt }).where(row => row.fleet_id === params.fleetId), connection);
      else executeInsert(database, schema, (query, params) => query.insertInto('fleet_connection').values({ fleet_id: params.fleetId,
        connection_id: params.connectionId, credential_id: params.credentialId, last_seen_at: params.lastSeenAt, expires_at: params.expiresAt, closed_at: params.closedAt }), connection);
      return success(undefined);
    }); },
  };
}
