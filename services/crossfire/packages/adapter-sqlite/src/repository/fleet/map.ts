import type { Fleet } from '@ctlflow/crossfire-domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapFleet(row: Tables['fleet']): Fleet {
  return {
    archivedAt: row.archived_at,
    id: row.id,
    deliveryEnabled: row.delivery_enabled === 1,
    label: row.label,
    controllerName: row.controller_name,
    revision: row.revision,
    updatedAt: row.updated_at,
    ownerId: row.owner_id,
    fleetKey: row.fleet_key,
    createdAt: row.created_at,
  };
}
