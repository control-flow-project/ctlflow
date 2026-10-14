import type Database from 'better-sqlite3';
import { forgetFixtureMigrations, loggingSchema } from './storage.js';

export function restoreSchema16Logging(database: Database.Database): void {
  forgetFixtureMigrations(database);
  for (const name of loggingSchema.matchAll(/CREATE INDEX (\w+)/gu)) database.exec('DROP INDEX ' + name[1]);
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    database.exec('CREATE TRIGGER protect_' + table + '_delete BEFORE DELETE ON ' + table
      + " BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;");
  database.pragma('user_version=16');
}
