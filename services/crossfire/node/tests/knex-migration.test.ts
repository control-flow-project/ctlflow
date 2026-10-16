import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import knex from 'knex';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { databaseConfiguration, migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { backupBeforeMigration, prepareDatabaseUpgrade } from '../apps/server/src/database-upgrade.js';
import { migrationArguments } from '../apps/server/src/container-commands.js';
import { openTestStore, forgetFixtureMigrations } from './support/storage.js';
import { schema13Store } from './support/schema13.js';

function directory(scope: TestContext): string {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'crossfire-knex-'));
  cleanup(scope, () => rmSync(path, { recursive: true }));
  return path;
}

test('applications only open existing Knex databases and cannot create or migrate', async scope => {
  const root = directory(scope), path = join(root, 'management.sqlite');
  assert.throws(() => openStore(path), /ENOENT|exist/u);
  assert.equal(existsSync(path), false);
  const prior = schema13Store();
  try { writeFileSync(path, prior.serialize(), { mode: 0o600 }); } finally { prior.close(); }
  const before = readFileSync(path);
  assert.throws(() => openStore(path), /Knex migration container/u);
  assert.deepEqual(readFileSync(path), before, 'Application open cannot modify a deployed schema');
  await migrateDatabase(path);
  const current = openStore(path);
  try {
    assert.deepEqual(current.prepare<[], { name: string }>('SELECT name FROM knex_migrations ORDER BY name').all().map(row => row.name), contract.migrations);
    assert.equal(current.pragma('user_version', { simple: true }), contract.version);
  } finally { current.close(); }
});

test('Knex accepts new stores, is repeatable and refuses unrelated or future stores without mutation', async scope => {
  const path = join(directory(scope), 'management.sqlite');
  await migrateDatabase(path);
  const before = readFileSync(path);
  await migrateDatabase(path);
  assert.deepEqual(readFileSync(path).subarray(100), before.subarray(100), 'Repeat migration preserves every database page; Knex lock writes can advance SQLite header counters');
  const database = openStore(path);
  try { database.pragma('user_version=18'); } finally { database.close(); }
  const future = readFileSync(path);
  await assert.rejects(() => migrateDatabase(path), /Unsupported Crossfire schema/u);
  assert.deepEqual(readFileSync(path), future);
  const unrelated = join(directory(scope), 'unrelated.sqlite');
  const foreign = new Database(unrelated);
  try { foreign.exec("CREATE TABLE unrelated(id TEXT PRIMARY KEY); INSERT INTO unrelated VALUES('retained')"); }
  finally { foreign.close(); }
  chmodSync(unrelated, 0o600);
  const foreignBytes = readFileSync(unrelated);
  await assert.rejects(() => migrateDatabase(unrelated), /Unsupported Crossfire schema/u);
  assert.deepEqual(readFileSync(unrelated), foreignBytes, 'Migration admission cannot add metadata to unrelated storage');
});

test('migration admission rejects symlinks, relative paths and publicly accessible stores', async scope => {
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
    assert.equal(failed.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='transient'").get()?.count, 0);
    assert.equal(failed.pragma('user_version', { simple: true }), 0);
  } finally { failed.close(); }
  await migrateDatabase(path);
  const ready = openStore(path); ready.close();
});

test('upgrade backs up a deployed store and verifies it before Knex mutation', async scope => {
  const root = directory(scope), path = join(root, 'management.sqlite');
  const original = openTestStore();
  try { forgetFixtureMigrations(original); writeFileSync(path, original.serialize(), { mode: 0o600 }); }
  finally { original.close(); }
  const before = readFileSync(path), backup = await backupBeforeMigration(root);
  assert(backup); assert.deepEqual(readFileSync(path), before);
  const copy = new Database(backup, { readonly: true });
  try {
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(copy.pragma('foreign_key_check'), []);
    assert.equal(copy.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM permission').get()?.count, 36);
  } finally { copy.close(); }
  await migrateDatabase(path);
  assert.equal(await backupBeforeMigration(root), null, 'A fully migrated store does not accumulate redundant backups');
});

test('every upgrade phase blocks later phases on failure, with no automatic fallback', async () => {
  for (const failure of ['stop', 'backup', 'migrate', null]) {
    const events: string[] = [];
    const step = async (name: string) => { events.push(name); if (name === failure) throw new Error(name + ' failed'); };
    const run = () => prepareDatabaseUpgrade({ stopWriters: () => step('stop'), backup: () => step('backup'), migrate: () => step('migrate') });
    if (failure) await assert.rejects(run, new RegExp(failure + ' failed', 'u')); else await run();
    assert.deepEqual(events, failure === 'stop' ? ['stop'] : failure === 'backup' ? ['stop', 'backup'] : ['stop', 'backup', 'migrate']);
  }
});

test('one migration image and isolated container serve every selected backend implementation', () => {
  const image = 'sha256:' + 'a'.repeat(64);
  const args = migrationArguments('/private/current', image, 'crossfire-tests.slice');
  assert.equal(args.at(-1), image); assert.equal(args.includes('--rm'), false); assert(args.includes('--read-only'));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--cgroup-parent') + 1], 'crossfire-tests.slice');
  assert.equal(args.includes('--publish'), false);
});
