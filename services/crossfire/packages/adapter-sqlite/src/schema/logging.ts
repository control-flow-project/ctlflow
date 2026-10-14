import schemaDefinition from '@ctlflow/crossfire-data/sqlite/schema' with { type: 'json' };
import type Database from 'better-sqlite3';

export const loggingSchema = schemaDefinition.parts.loggingSchema;

export function migrateLoggingSchema(database: Database.Database): void {
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    database.exec('DROP TRIGGER IF EXISTS protect_' + table + '_delete;');
  database.exec(loggingSchema);
  database.pragma('user_version = 17');
}
