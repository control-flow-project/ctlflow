import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import knex from 'knex';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { databaseConfiguration, migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { appliedMigrations, metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { defineSelect } from '@tinqerjs/tinqer';
import { executeSelect, toSql } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { value } from './support/application.js';

function directory(scope: TestContext): string {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'crossfire-knex-'));
  cleanup(scope, () => rmSync(path, { recursive: true }));
  return path;
}

test('applications only open existing Knex databases and cannot create or migrate', async scope => {
  const root = directory(scope), path = join(root, 'management.sqlite');
  assert.throws(() => openStore(path), /ENOENT|exist/u);
  assert.equal(existsSync(path), false);
  await migrateDatabase(path);
  const current = openStore(path);
  try {
    assert.deepEqual(appliedMigrations(current), contract.migrations);
    assert.equal(sqliteMetadata.databaseIdentity(current).version, contract.version);
  } finally { current.close(); }
});

test('Knex creates the current schema once and repeated runs retain all records', async scope => {
  const path = join(directory(scope), 'management.sqlite');
  await migrateDatabase(path);
  const database = openStore(path);
  try {
    value(createRepositories(database).principal.insert({ id: 'retained', backendUserId: 'opaque/person', kind: 'human', status: 'active', revision: 7, createdAt: 1 }));
  } finally { database.close(); }
  await migrateDatabase(path);
  const current = openStore(path);
  try {
    assert.equal(value(createRepositories(current).principal.find({ id: 'retained' }))?.revision, 7);
    assert.deepEqual(appliedMigrations(current), contract.migrations);
    const generated = toSql(defineSelect(schema, query => query.from('listener_run').groupBy(row => row.agent_id)
      .select(group => ({ agentId: group.key, activeMs: group.sum(row => row.active_ms), messagesDelivered: group.sum(row => row.messages_delivered), lastSeenAt: group.max(row => row.last_seen_at) }))), {});
    const plan = current.prepare<[Record<string, unknown>], { detail: string }>('EXPLAIN QUERY PLAN ' + generated.sql).all(generated.params);
    assert(plan.some(row => row.detail.includes('COVERING INDEX ix_listener_run_agent_totals')));
    assert.deepEqual(sqliteMetadata.foreignKeyViolations(current), []);
  } finally { current.close(); }
});

test('migration file access rejects symlinks, relative paths and publicly accessible stores', async scope => {
  const root = directory(scope), target = join(root, 'private.sqlite');
  await migrateDatabase(target);
  assert.throws(() => databaseConfiguration('relative.sqlite'), /absolute/u);
  const alias = join(root, 'alias.sqlite'); symlinkSync(target, alias);
  assert.throws(() => databaseConfiguration(alias), /ELOOP/u);
  chmodSync(target, 0o644);
  assert.throws(() => databaseConfiguration(target), /private/u);
  assert.equal(readFileSync(target).length > 0, true);
});

test('Knex recovers clean initial migration failure without a reset or another creator', async scope => {
  const path = join(directory(scope), 'management.sqlite');
  const migrator = knex(databaseConfiguration(path));
  try {
    await assert.rejects(() => migrator.migrate.latest({ migrationSource: {
      getMigrations: () => Promise.resolve(['controlled']), getMigrationName: () => 'controlled',
      getMigration: () => Promise.resolve({ async up(transaction: knex.Knex) {
        await transaction.schema.createTable('transient', table => table.text('id'));
        throw new Error('controlled initial failure');
      }, async down() { throw new Error('not used'); } }),
    } }), /controlled initial failure/u);
  } finally { await migrator.destroy(); }
  const failed = new Database(path);
  try {
    assert.equal(executeSelect(failed, metadataSchema, query => query.from('sqlite_schema').where(row => row.type === 'table' && row.name === 'transient').count()), 0);
    assert.equal(sqliteMetadata.databaseIdentity(failed).version, 0);
  } finally { failed.close(); }
  await migrateDatabase(path);
  const ready = openStore(path); ready.close();
});

