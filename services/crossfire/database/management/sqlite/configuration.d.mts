import type { Knex } from 'knex';
import type Database from 'better-sqlite3';
export function databaseConfiguration(filename: string): Knex.Config;
export function admitDatabase(connection: Database.Database): void;
export function migrateDatabase(filename: string): Promise<void>;
