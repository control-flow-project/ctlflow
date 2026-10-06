import type Database from 'better-sqlite3';
import { identitySchema } from './identity.js';
import { authorizationSchema } from './authorization.js';
import { enrollmentSchema } from './enrollment.js';
import { roomAccessSchema } from './room-access.js';
import { activitySchema } from './activity.js';
import { auditSchema } from './audit.js';
import { seedReferenceData } from './reference-data.js';
import { fleetControlSchema } from './fleet-control.js';
import { wakeUpSchema } from './wake-up.js';
import { ownerConversationSchema } from './owner-conversation.js';
import { runtimeSchema } from './runtime.js';
import { statisticsSchema } from './statistics.js';
import { fleetPolicySchema } from './fleet-policy.js';
import { fleetRuntimeSchema } from './fleet-runtime.js';
import { publicationSchema } from './publication.js';
import { controllerRunGuards, enrollmentArchiveSchema, enrollmentArchiveGuards, nativeStopSchema } from './controller.js';
import { migrateWakeSchema } from './wake-migration.js';
export const SCHEMA_VERSION = 14;
export function createSchema(database: Database.Database): void {
  const application = database.pragma('application_id', { simple: true });
  const version = database.pragma('user_version', { simple: true });
  if (application === 1129465426 && version === SCHEMA_VERSION) return;
  if (application === 1129465426 && version === 13) {
    migrateWakeSchema(database);
    return;
  }
  const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || application !== 0 || version !== 0) throw new Error('Unsupported Crossfire schema; only deployed schema 13 can advance to the current schema. No data was changed');
  database.transaction(() => {
    database.exec(identitySchema + authorizationSchema + enrollmentSchema + roomAccessSchema + activitySchema + auditSchema + fleetControlSchema + wakeUpSchema + ownerConversationSchema + runtimeSchema + statisticsSchema + fleetPolicySchema + fleetRuntimeSchema + publicationSchema + enrollmentArchiveSchema + enrollmentArchiveGuards + controllerRunGuards + nativeStopSchema);
    seedReferenceData(database);
    database.exec('CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id)');
    database.pragma('application_id = 1129465426');
    database.pragma('user_version = ' + SCHEMA_VERSION);
  }).immediate();
}
