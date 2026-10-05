import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapRolePermission } from './map.js';
import { stored } from '../stored.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { RolePermissionRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createRolePermissionRepository(database: Database.Database): RolePermissionRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('role_permission')
          .where(row => row.role_code === params.roleCode && row.permission_code === params.permissionCode).firstOrDefault(), key);
        return success(row ? mapRolePermission(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('role_permission').values({
      role_code: params.roleCode,
      permission_code: params.permissionCode,
      grant_scope: params.grantScope,
        }), value);
        return success(undefined);
      });
    },
  };
}
