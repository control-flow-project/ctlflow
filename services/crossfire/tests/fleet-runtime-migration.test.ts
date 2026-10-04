import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createSchema } from '@crossfire/adapter-sqlite/schema/create-schema';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanup } from '@crossfire/test-support/cleanup';
import { applicationFixture } from './support/application.js';

test('session operation migration preserves the complete existing database and adds normalized indexed command state', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-session-migration-')), file = join(directory, 'state.sqlite');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const fixture = await applicationFixture(scope, file);
  await fixture.agent(fixture.admin.actor, 'retained-agent');
  const database = openStore(file);
  try {
    database.exec('DROP TABLE fleet_runtime_operation;'); database.pragma('user_version = 10');
    const tables = (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const before = new Map(tables.map(table => [table, database.prepare('SELECT * FROM ' + table).all()]));
    createSchema(database); assert.equal(database.pragma('user_version', { simple: true }), 11);
    for (const table of tables) assert.deepEqual(database.prepare('SELECT * FROM ' + table).all(), before.get(table), table);
    assert.deepEqual(database.prepare('SELECT * FROM fleet_runtime_operation').all(), []);
    for (const index of ['uq_fleet_runtime_operation_active', 'ix_fleet_runtime_operation_created', 'ix_fleet_runtime_operation_agent', 'ix_fleet_runtime_operation_author', 'ix_fleet_runtime_operation_credential']) {
      assert(database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(index), index);
    }
    assert.deepEqual(database.pragma('foreign_key_check'), []); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    createSchema(database);
  } finally { database.close(); }
});

test('failed session migration rolls back its table, indexes and version instead of altering production state', () => {
  const database = openStore(':memory:');
  try {
    database.exec('DROP TABLE fleet_runtime_operation; CREATE INDEX ix_fleet_runtime_operation_created ON principal(id);'); database.pragma('user_version = 10');
    assert.throws(() => createSchema(database), /already exists/u);
    assert.equal(database.pragma('user_version', { simple: true }), 10);
    assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='fleet_runtime_operation'").get(), undefined);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
