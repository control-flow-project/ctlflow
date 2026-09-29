import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleetControllerMetadata } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { FleetControllerMetadataRepository } from '@crossfire/domain/port/repositories';
export function createFleetControllerMetadataRepository(database: Database.Database): FleetControllerMetadataRepository {
  return {
    find(key) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_controller_metadata').where(row => row.fleet_id === params.fleetId && row.key === params.key).firstOrDefault(), key);
      return success(row ? mapFleetControllerMetadata(row) : null);
    }); },
    insert(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_controller_metadata').values({
          fleet_id: params.fleetId,
          key: params.key,
          value: params.value,
      }), value); return success(undefined);
    }); },
    update(value) { return stored(() => {
      const changed = executeUpdate(database, schema, (query, params) => query.update('fleet_controller_metadata').set({
        value: params.value,
      }).where(row => row.fleet_id === params.fleetId && row.key === params.key), value);
      return changed === 1 ? success(undefined) : failure('missing', 'FleetControllerMetadata not found');
    }); },
    remove(key) { return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_controller_metadata').where(row => row.fleet_id === params.fleetId && row.key === params.key), key); return success(undefined); }); },
  };
}
