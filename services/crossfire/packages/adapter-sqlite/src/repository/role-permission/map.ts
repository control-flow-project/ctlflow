import type { RolePermission } from '@crossfire/domain/authorization/types';
import type { Tables } from '../../schema/tables.js';
export function mapRolePermission(row: Tables['role_permission']): RolePermission {
  return {
    roleCode: row.role_code,
    permissionCode: row.permission_code,
    grantScope: row.grant_scope,
  };
}
