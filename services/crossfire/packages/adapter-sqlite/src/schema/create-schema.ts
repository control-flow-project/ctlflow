import type Database from 'better-sqlite3';
import { seedReferenceData } from './reference-data.js';
import { migrateWakeSchema } from './wake-migration.js';
import { migrateAgentNames } from './name-migration.js';
import { migrateUsageSchema } from './usage-migration.js';
import { migrateLoggingSchema } from './logging.js';
import schemaDefinition from '@ctlflow/crossfire-data/sqlite/schema' with { type: 'json' };
export const SCHEMA_VERSION = schemaDefinition.version;
export function createSchema(database: Database.Database): void {
  const application = database.pragma('application_id', { simple: true });
  const version = database.pragma('user_version', { simple: true });
  if (application === 1129465426 && version === SCHEMA_VERSION) return;
  if (application === 1129465426 && [13, 14, 15, 16].includes(Number(version))) {
    const foreignKeys = database.pragma('foreign_keys', { simple: true });
    database.pragma('foreign_keys=OFF');
    try { database.transaction(() => {
      if (version === 13) migrateWakeSchema(database);
      if (version === 14) migrateAgentNames(database);
      if (Number(version) <= 15) migrateUsageSchema(database);
      migrateLoggingSchema(database);
    }).immediate(); } finally { database.pragma('foreign_keys=' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
    return;
  }
  const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || application !== 0 || version !== 0) throw new Error('Unsupported Crossfire schema; only deployed schemas 13, 14, 15 and 16 can advance to the current schema. No data was changed');
  database.transaction(() => {
    database.exec(schemaDefinition.initialization.map(name => schemaDefinition.parts[name as keyof typeof schemaDefinition.parts]).join(''));
    seedReferenceData(database);
    database.exec('CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id)');
    database.pragma('application_id = 1129465426');
    database.pragma('user_version = ' + SCHEMA_VERSION);
  }).immediate();
}
