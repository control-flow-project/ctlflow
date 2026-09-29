import type { FleetInstance } from '@crossfire/domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapFleetInstance(row: Tables['fleet_instance']): FleetInstance {
  return {
    ownerId: row.owner_id,
    fleetKey: row.fleet_key,
    instanceKey: row.instance_key,
    agentId: row.agent_id,
  };
}
