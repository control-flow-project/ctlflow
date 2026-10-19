import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import schemaDefinition from '@ctlflow/crossfire-data/management/sqlite/schema' with { type: 'json' };
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };
import { permissionCatalog, roleCatalog } from '@ctlflow/crossfire-domain/authorization/catalog';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema as tables } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { metadataSchema, tableMetadata } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

test('shared SQLite schema preserves canonical authorization and direct language interchangeability', () => {
  const database = openTestStore(':memory:');
  try {
    assert.equal(sqliteMetadata.databaseIdentity(database).version, contract.version);
    assert.equal(sqliteMetadata.databaseIdentity(database).application, schemaDefinition.application);
    const schema = executeSelect(database, metadataSchema, query => query.from('sqlite_schema')
      .where(row => !row.name.startsWith('sqlite_') && !row.name.startsWith('knex_')).select(row => ({ type: row.type, name: row.name })));
    assert.equal(schema.filter(row => row.type === 'table').length, 57);
    assert.equal(schema.filter(row => row.type === 'index').length, 87);
    assert.equal(schema.filter(row => row.type === 'trigger').length, 20);
    assert.equal(schema.some(row => row.name.startsWith('enrollment_archive')), false, 'Only current enrollment storage exists');
    const required = ['controller_fleet_id', 'controller_connection_id', 'controller_credential_id', 'release'];
    const columns = tableMetadata(database, 'listener_run').columns;
    assert.deepEqual(columns.filter(column => required.includes(column.name)).map(column => ({ name: column.name, required: column.notnull })),
      required.map(name => ({ name, required: 1 })), 'Every listener run retains its controller binding and installed release');
    const indexes = Object.values(schemaDefinition.parts).flatMap(part => [...part.matchAll(/CREATE (UNIQUE )?INDEX \w+ ON (\w+)\(([^;]+)\);/gu)]
      .map(match => [Boolean(match[1]), match[2], match[3]!.replace(/\s+/gu, '')].join('|')));
    assert.equal(new Set(indexes).size, indexes.length, 'No duplicate explicit indexes');
    assert.deepEqual(schemaDefinition.reference.role, roleCatalog.map(role => ({ code: role.code, principal_kind: role.principalKind, label: role.label })));
    const permissions = permissionCatalog.map(permission => ({ code: permission.code, grant_scope: permission.grantScope, description: permission.description }));
    assert.deepEqual(schemaDefinition.reference.permission.map(({ code, grant_scope }) => ({ code, grant_scope })), permissions.map(({ code, grant_scope }) => ({ code, grant_scope })));
    assert.deepEqual(schemaDefinition.reference.role_permission, permissionCatalog.flatMap(permission => permission.roles.map(role => ({ role_code: role, permission_code: permission.code, grant_scope: 'role' }))));
    assert.deepEqual(executeSelect(database, tables, query => query.from('role')), schemaDefinition.reference.role);
    assert.deepEqual(executeSelect(database, tables, query => query.from('permission')), permissions);
    assert.deepEqual(executeSelect(database, tables, query => query.from('role_permission')), schemaDefinition.reference.role_permission);
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  } finally { database.close(); }
});
