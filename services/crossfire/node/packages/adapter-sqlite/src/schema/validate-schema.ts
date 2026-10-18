import type Database from 'better-sqlite3';
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };
import { appliedMigrations, databaseIdentity, hasMigrationTable } from './metadata.js';

export const SCHEMA_VERSION = contract.version;

export function validateSchema(database: Database.Database): void {
  const identity = databaseIdentity(database);
  if (identity.application !== contract.application || identity.version !== contract.version)
    throw new Error('Unsupported Crossfire schema; run the Knex migration container before starting the server. No data was changed');
  if (!hasMigrationTable(database)) throw new Error('Management database has not been migrated by Knex; run the migration container');
  const applied = appliedMigrations(database);
  if (applied.length !== contract.migrations.length || applied.some((name, index) => name !== contract.migrations[index]))
    throw new Error('Management database Knex migrations do not match this release; run its migration container');
}
