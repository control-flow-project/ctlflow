import type { Fleet } from '../../../../domain/src/enrollment/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapFleet(row: Tables['fleet']): Fleet {
  return {
    ownerId: row.owner_id,
    fleetKey: row.fleet_key,
    createdAt: row.created_at,
  };
}
