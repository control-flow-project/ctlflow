import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import schemaDefinition from '@ctlflow/crossfire-data/management/sqlite/schema' with { type: 'json' };
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };
import { permissionCatalog, roleCatalog } from '@ctlflow/crossfire-domain/authorization/catalog';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema as tables } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

test('shared SQLite schema preserves canonical authorization and direct language interchangeability', () => {
  const database = openTestStore(':memory:');
  try {
    assert.equal(sqliteMetadata.databaseIdentity(database).version, contract.version);
    assert.equal(sqliteMetadata.databaseIdentity(database).application, schemaDefinition.application);
    const schema = executeSelect(database, metadataSchema, query => query.from('sqlite_schema')
      .where(row => !row.name.startsWith('sqlite_') && !row.name.startsWith('knex_')).select(row => ({ type: row.type, name: row.name })));
    assert.equal(schema.filter(row => row.type === 'table').length, 63);
    assert.equal(schema.filter(row => row.type === 'index').length, 94);
    assert.equal(schema.filter(row => row.type === 'trigger').length, 26);
    assert.deepEqual(schemaDefinition.reference.role, roleCatalog.map(role => ({ code: role.code, principal_kind: role.principalKind, label: role.label })));
    assert.deepEqual(schemaDefinition.reference.permission, permissionCatalog.map(permission => ({ code: permission.code, grant_scope: permission.grantScope, description: permission.description })));
    assert.deepEqual(schemaDefinition.reference.role_permission, permissionCatalog.flatMap(permission => permission.roles.map(role => ({ role_code: role, permission_code: permission.code, grant_scope: 'role' }))));
    assert.deepEqual(executeSelect(database, tables, query => query.from('role')), schemaDefinition.reference.role);
    assert.deepEqual(executeSelect(database, tables, query => query.from('permission')), schemaDefinition.reference.permission);
    assert.deepEqual(executeSelect(database, tables, query => query.from('role_permission')), schemaDefinition.reference.role_permission);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});
