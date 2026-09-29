import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapFleet } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { FleetRepository } from '../../../../domain/src/port/repositories.js';

export function createFleetRepository(database: Database.Database): FleetRepository {
  return {
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
      owner_id: params.ownerId,
      fleet_key: params.fleetKey,
      created_at: params.createdAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('fleet').set({
      created_at: params.createdAt,
        }).where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey), value);
        return changed === 1 ? success(undefined) : failure('missing', 'Fleet not found');
      });
    },
  };
}
