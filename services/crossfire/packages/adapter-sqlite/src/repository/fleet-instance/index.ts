import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleetInstance } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { FleetInstanceRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createFleetInstanceRepository(database: Database.Database): FleetInstanceRepository {
  return {
    remove(key) { return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_instance')
      .where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey && row.instance_key === params.instanceKey), key); return success(undefined); }); },
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('fleet_instance')
          .where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey && row.instance_key === params.instanceKey).firstOrDefault(), key);
        return success(row ? mapFleetInstance(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('fleet_instance').values({
      owner_id: params.ownerId,
      fleet_key: params.fleetKey,
      instance_key: params.instanceKey,
      agent_id: params.agentId,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('fleet_instance').set({
      agent_id: params.agentId,
        }).where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey && row.instance_key === params.instanceKey), value);
        return changed === 1 ? success(undefined) : failure('missing', 'FleetInstance not found');
      });
    },
  };
}
