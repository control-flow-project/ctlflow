import type { FleetCredential } from '@ctlflow/crossfire-domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapFleetCredential(row: Tables['fleet_credential']): FleetCredential {
  return { id: row.id, fleetId: row.fleet_id, secretHash: row.secret_hash, createdAt: row.created_at, revokedAt: row.revoked_at };
}
