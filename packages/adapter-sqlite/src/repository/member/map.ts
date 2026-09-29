import type { Member } from '../../../../domain/src/identity/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapMember(row: Tables['member']): Member {
  return {
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    displayName: row.display_name,
  };
}
