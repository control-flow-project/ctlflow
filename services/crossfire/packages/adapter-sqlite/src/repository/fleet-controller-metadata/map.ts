import type { FleetControllerMetadata } from '@crossfire/domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapFleetControllerMetadata(row: Tables['fleet_controller_metadata']): FleetControllerMetadata {
  return { fleetId: row.fleet_id, key: row.key, value: row.value };
}
