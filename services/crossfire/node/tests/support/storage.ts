import Database from 'better-sqlite3';
import knex from 'knex';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { admitDatabase, databaseConfiguration } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import schemaDefinition from '@ctlflow/crossfire-data/management/sqlite/schema' with { type: 'json' };
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { validateSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { migrationChange, migrationQuery } from './migration-data.js';

export const loggingSchema = schemaDefinition.parts.loggingSchema;
export const statisticsSchema = schemaDefinition.parts.statisticsSchema;

const migrator = knex(databaseConfiguration(':memory:'));
let template: Buffer;
try {
  await migrator.migrate.latest();
  const connection: Database.Database = await migrator.client.acquireConnection();
  try { template = connection.serialize(); }
  finally { await migrator.client.releaseConnection(connection); }
} finally { await migrator.destroy(); }

export function openTestStore(path = ':memory:'): Database.Database {
  if (path === ':memory:') {
    const database = new Database(template);
    validateSchema(database);
    database.pragma('foreign_keys=ON');
    return database;
  }
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, template, { mode: 0o600, flag: 'wx' });
  }
  return openStore(path);
}

export function applicationDatabase(scope: TestContext, path = ':memory:'): string {
  if (path === ':memory:') {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'crossfire-application-'));
    cleanup(scope, () => rmSync(directory, { recursive: true }));
    path = join(directory, 'management.sqlite');
  }
  const database = openTestStore(path);
  database.close();
  return path;
}

export function forgetFixtureMigrations(database: Database.Database): void {
  migrationChange(database, migrationQuery('knex_migrations').delete());
}

export async function migrateFixture(database: Database.Database): Promise<void> {
  admitDatabase(database);
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys=OFF');
  const fixtureKnex = knex({ ...databaseConfiguration(':memory:'), pool: { min: 0, max: 1 } });
  fixtureKnex.client.acquireConnection = () => Promise.resolve(database);
  fixtureKnex.client.releaseConnection = () => Promise.resolve();
  try { await fixtureKnex.migrate.latest(); }
  finally { await fixtureKnex.destroy(); database.pragma('foreign_keys=' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
