import type { Role } from '@ctlflow/crossfire-domain/authorization/types';
import type { Tables } from '../../schema/tables.js';
export function mapRole(row: Tables['role']): Role {
  return {
    code: row.code,
    principalKind: row.principal_kind,
    label: row.label,
  };
}
