import type Database from 'better-sqlite3';
import { forgetFixtureMigrations, loggingSchema } from './storage.js';
import { migrationChange, migrationQuery, migrationRows } from './migration-data.js';

export function restoreSchema16Logging(database: Database.Database): void {
  forgetFixtureMigrations(database);
  migrationChange(database, migrationQuery.schema.alterTable('listener_run', table => table.dropIndex([], 'ix_listener_run_agent_totals')));
  for (const name of loggingSchema.matchAll(/CREATE INDEX (\w+)/gu)) {
    const table = migrationRows(database, migrationQuery('sqlite_schema').select('tbl_name').where('type', 'index').where('name', name[1]))[0]?.tbl_name;
    if (typeof table !== 'string') throw new Error('Missing logging fixture index');
    migrationChange(database, migrationQuery.schema.alterTable(table, definition => definition.dropIndex([], name[1])));
  }
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    database.exec('CREATE TRIGGER protect_' + table + '_delete BEFORE DELETE ON ' + table
      + " BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;");
  database.pragma('user_version=16');
}
