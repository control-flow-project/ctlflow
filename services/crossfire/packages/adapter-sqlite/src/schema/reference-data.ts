import type Database from 'better-sqlite3';
import { executeInsert, executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { permissionCatalog, roleCatalog } from '@crossfire/domain/authorization/catalog';
import { schema } from './tables.js';
export function seedReferenceData(database: Database.Database): void {
  for (const role of roleCatalog) if (!executeSelect(database, schema, (query, params) => query.from('role').where(row => row.code === params.code).firstOrDefault(), role)) executeInsert(database, schema, (query, params) => query.insertInto('role')
    .values({ code: params.code, principal_kind: params.principalKind, label: params.label }), role);
  for (const permission of permissionCatalog) {
    if (!executeSelect(database, schema, (query, params) => query.from('permission').where(row => row.code === params.code).firstOrDefault(), permission)) executeInsert(database, schema, (query, params) => query.insertInto('permission')
      .values({ code: params.code, grant_scope: params.grantScope, description: params.description }), permission);
    for (const roleCode of permission.roles) if (!executeSelect(database, schema, (query, params) => query.from('role_permission').where(row => row.role_code === params.roleCode && row.permission_code === params.permissionCode).firstOrDefault(), { roleCode, permissionCode: permission.code })) executeInsert(database, schema, (query, params) => query.insertInto('role_permission')
      .values({ role_code: params.roleCode, permission_code: params.permissionCode, grant_scope: 'role' }),
      { roleCode, permissionCode: permission.code });
  }
}
