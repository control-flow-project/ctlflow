import type Database from 'better-sqlite3';
import { executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import { permissionCatalog, roleCatalog } from '@crossfire/domain/authorization/catalog';
import { schema } from './tables.js';
export function seedReferenceData(database: Database.Database): void {
  for (const role of roleCatalog) executeInsert(database, schema, (query, params) => query.insertInto('role')
    .values({ code: params.code, principal_kind: params.principalKind, label: params.label }), role);
  for (const permission of permissionCatalog) {
    executeInsert(database, schema, (query, params) => query.insertInto('permission')
      .values({ code: params.code, grant_scope: params.grantScope, description: params.description }), permission);
    for (const roleCode of permission.roles) executeInsert(database, schema, (query, params) => query.insertInto('role_permission')
      .values({ role_code: params.roleCode, permission_code: params.permissionCode, grant_scope: 'role' }),
      { roleCode, permissionCode: permission.code });
  }
}
