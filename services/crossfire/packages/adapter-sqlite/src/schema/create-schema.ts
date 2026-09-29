import type Database from 'better-sqlite3';
import { identitySchema } from './identity.js';
import { authorizationSchema } from './authorization.js';
import { enrollmentSchema } from './enrollment.js';
import { roomAccessSchema } from './room-access.js';
import { activitySchema } from './activity.js';
import { auditSchema } from './audit.js';
import { seedReferenceData } from './reference-data.js';
export function createSchema(database: Database.Database): void {
  const application = database.pragma('application_id', { simple: true });
  const version = database.pragma('user_version', { simple: true });
  if (application === 1129465426 && version === 1) return;
  const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || application !== 0 || version !== 0) throw new Error('This database does not contain the current Crossfire schema; initialize a fresh development database');
  database.transaction(() => {
    database.exec(identitySchema + authorizationSchema + enrollmentSchema + roomAccessSchema + activitySchema + auditSchema);
    seedReferenceData(database);
    database.pragma('application_id = 1129465426');
    database.pragma('user_version = 1');
  }).immediate();
}
