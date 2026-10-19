import type { Knex } from 'knex';
export function databaseConfiguration(filename: string): Knex.Config;
export function migrateDatabase(filename: string): Promise<void>;
