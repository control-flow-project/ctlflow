import type { Principal } from '@ctlflow/crossfire-domain/identity/types';
import type { Tables } from '../../schema/tables.js';
export function mapPrincipal(row: Tables['principal']): Principal {
  return {
    id: row.id,
    matrixUserId: row.matrix_user_id,
    kind: row.kind,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
  };
}
