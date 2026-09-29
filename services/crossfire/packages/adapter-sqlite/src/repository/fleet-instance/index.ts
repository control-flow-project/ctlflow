import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleetInstance } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { FleetInstanceRepository } from '../../../../domain/src/port/repositories.js';

export function createFleetInstanceRepository(database: Database.Database): FleetInstanceRepository {
  return {
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
