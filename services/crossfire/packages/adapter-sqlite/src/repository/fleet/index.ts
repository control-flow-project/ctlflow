import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleet } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { FleetRepository } from '@crossfire/domain/port/repositories';

export function createFleetRepository(database: Database.Database): FleetRepository {
  return {
    findById(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? mapFleet(row) : null);
    }); },
    remove(key) { return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('fleet')
      .where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey), key); return success(undefined); }); },
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('fleet')
          .where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey).firstOrDefault(), key);
        return success(row ? mapFleet(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('fleet').values({
      id: params.id,
      delivery_enabled: params.deliveryEnabled,
      label: params.label,
      controller_name: params.controllerName,
      revision: params.revision,
      updated_at: params.updatedAt,
      owner_id: params.ownerId,
      fleet_key: params.fleetKey,
      created_at: params.createdAt,
        }), { ...value, deliveryEnabled: value.deliveryEnabled ? 1 : 0 });
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('fleet').set({
      delivery_enabled: params.deliveryEnabled,
      label: params.label,
      controller_name: params.controllerName,
      revision: params.revision,
      updated_at: params.updatedAt,
      created_at: params.createdAt,
        }).where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey), { ...value, deliveryEnabled: value.deliveryEnabled ? 1 : 0 });
        return changed === 1 ? success(undefined) : failure('missing', 'Fleet not found');
      });
    },
  };
}
