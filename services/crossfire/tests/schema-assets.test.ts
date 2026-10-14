import { test } from 'node:test';
import assert from 'node:assert/strict';
import schemaDefinition from '@ctlflow/crossfire-data/sqlite/schema' with { type: 'json' };
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { permissionCatalog, roleCatalog } from '@ctlflow/crossfire-domain/authorization/catalog';

test('shared SQLite schema preserves canonical authorization and direct language interchangeability', () => {
  const database = openStore(':memory:');
  try {
    assert.equal(database.pragma('user_version', { simple: true }), schemaDefinition.version);
    assert.equal(database.pragma('application_id', { simple: true }), schemaDefinition.application);
    const schema = database.prepare("SELECT type,name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as { type: string; name: string }[];
    assert.equal(schema.filter(row => row.type === 'table').length, 63);
    assert.equal(schema.filter(row => row.type === 'index').length, 93);
    assert.equal(schema.filter(row => row.type === 'trigger').length, 26);
    assert.deepEqual(schemaDefinition.reference.role, roleCatalog.map(role => ({ code: role.code, principal_kind: role.principalKind, label: role.label })));
    assert.deepEqual(schemaDefinition.reference.permission, permissionCatalog.map(permission => ({ code: permission.code, grant_scope: permission.grantScope, description: permission.description })));
    assert.deepEqual(schemaDefinition.reference.role_permission, permissionCatalog.flatMap(permission => permission.roles.map(role => ({ role_code: role, permission_code: permission.code, grant_scope: 'role' }))));
    for (const table of ['role', 'permission', 'role_permission'] as const) {
      assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), schemaDefinition.reference[table]);
    }
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
