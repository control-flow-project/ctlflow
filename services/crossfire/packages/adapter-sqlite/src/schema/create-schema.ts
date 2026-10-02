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
export function createSchema(database: Database.Database): void {
  const application = database.pragma('application_id', { simple: true });
  const version = database.pragma('user_version', { simple: true });
  if (application === 1129465426 && version === 5) return;
  if (application === 1129465426 && (version === 1 || version === 2 || version === 3 || version === 4)) {
    database.transaction(() => {
      if (version === 1) database.exec("ALTER TABLE instance_policy ADD COLUMN signup_mode TEXT NOT NULL DEFAULT 'invitation' CHECK(signup_mode IN ('invitation','open')); ALTER TABLE instance_policy ADD COLUMN invitation_issuers TEXT NOT NULL DEFAULT 'administrators' CHECK(invitation_issuers IN ('administrators','members')); CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id);");
      if (version < 3) database.exec('ALTER TABLE fleet ADD COLUMN delivery_enabled INTEGER NOT NULL DEFAULT 1 CHECK(delivery_enabled IN (0,1));' + fleetControlSchema);
      if (version < 4) {
        database.exec("ALTER TABLE agent_room_grant ADD COLUMN invitation_event_id TEXT CHECK(invitation_event_id IS NULL OR (substr(invitation_event_id, 1, 1) = '$' AND length(invitation_event_id) BETWEEN 2 AND 255));");
        database.exec("ALTER TABLE agent_room_grant ADD COLUMN admission_kind TEXT NOT NULL DEFAULT 'managed' CHECK(admission_kind IN ('managed','invitation') AND (admission_kind != 'invitation' OR invitation_event_id IS NOT NULL));");
        database.exec('ALTER TABLE room_grant_application ADD COLUMN creator INTEGER NOT NULL DEFAULT 0 CHECK(creator IN (0,1) AND (creator = 0 OR power_level IS NULL));');
      }
      database.exec(wakeUpSchema);
      database.exec('ALTER TABLE listener_run ADD COLUMN controller_bound INTEGER NOT NULL DEFAULT 0 CHECK(controller_bound IN (0,1));');
      seedReferenceData(database);
      database.pragma('user_version = 5');
    }).immediate();
    return;
  }
  const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length || application !== 0 || version !== 0) throw new Error('This database does not contain the current Crossfire schema; initialize a fresh development database');
  database.transaction(() => {
    database.exec(identitySchema + authorizationSchema + enrollmentSchema + roomAccessSchema + activitySchema + auditSchema + fleetControlSchema + wakeUpSchema);
    seedReferenceData(database);
    database.exec('CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id)');
    database.pragma('application_id = 1129465426');
    database.pragma('user_version = 5');
  }).immediate();
}
