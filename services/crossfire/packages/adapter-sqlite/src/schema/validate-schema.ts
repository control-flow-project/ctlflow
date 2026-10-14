import type Database from 'better-sqlite3';
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };

export const SCHEMA_VERSION = contract.version;

export function validateSchema(database: Database.Database): void {
  if (database.pragma('application_id', { simple: true }) !== contract.application
    || database.pragma('user_version', { simple: true }) !== contract.version)
    throw new Error('Unsupported Crossfire schema; run the Knex migration container before starting the server. No data was changed');
  const history = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='knex_migrations'").get();
  if (!history) throw new Error('Management database has not been migrated by Knex; run the migration container');
  const applied = database.prepare<[], { name: string }>('SELECT name FROM knex_migrations ORDER BY name').all().map(row => row.name);
  if (applied.length !== contract.migrations.length || applied.some((name, index) => name !== contract.migrations[index]))
    throw new Error('Management database Knex migrations do not match this release; run its migration container');
}
