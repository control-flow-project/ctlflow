import type { Agent } from '@ctlflow/crossfire-domain/identity/types';
import type { Tables } from '../../schema/tables.js';
export function mapAgent(row: Tables['agent']): Agent {
  return {
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    ownerId: row.owner_id,
    wakeMode: row.wake_mode,
  };
}
