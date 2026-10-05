import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleetCredential } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { FleetCredentialRepository } from '@ctlflow/crossfire-domain/port/repositories';
export function createFleetCredentialRepository(database: Database.Database): FleetCredentialRepository {
  return {
    find(key) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_credential').where(row => row.id === params.id).firstOrDefault(), key);
      return success(row ? mapFleetCredential(row) : null);
    }); },
    insert(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_credential').values({
          id: params.id,
          fleet_id: params.fleetId,
          secret_hash: params.secretHash,
          created_at: params.createdAt,
          revoked_at: params.revokedAt,
      }), value); return success(undefined);
    }); },
    update(value) { return stored(() => {
      const changed = executeUpdate(database, schema, (query, params) => query.update('fleet_credential').set({
        fleet_id: params.fleetId,
        secret_hash: params.secretHash,
        created_at: params.createdAt,
        revoked_at: params.revokedAt,
      }).where(row => row.id === params.id), value);
      return changed === 1 ? success(undefined) : failure('missing', 'FleetCredential not found');
    }); },
    remove(key) { return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_credential').where(row => row.id === params.id), key); return success(undefined); }); },
  };
}
