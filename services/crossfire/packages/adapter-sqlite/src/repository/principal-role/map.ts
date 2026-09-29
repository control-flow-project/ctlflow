import type { PrincipalRole } from '@crossfire/domain/authorization/types';
import type { Tables } from '../../schema/tables.js';
export function mapPrincipalRole(row: Tables['principal_role']): PrincipalRole {
  return {
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    roleCode: row.role_code,
    assignedByMemberId: row.assigned_by_member_id,
    assignedAt: row.assigned_at,
  };
}
