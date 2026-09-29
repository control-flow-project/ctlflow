import type { Agent } from '../../../../domain/src/identity/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapAgent(row: Tables['agent']): Agent {
  return {
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    ownerId: row.owner_id,
    displayNameOverride: row.display_name_override,
    wakeMode: row.wake_mode,
  };
}
