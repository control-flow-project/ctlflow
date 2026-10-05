import Database from 'better-sqlite3';
import { identitySchema } from '@crossfire/adapter-sqlite/schema/identity';
import { authorizationSchema } from '@crossfire/adapter-sqlite/schema/authorization';
import { enrollmentSchema } from '@crossfire/adapter-sqlite/schema/enrollment';
import { roomAccessSchema } from '@crossfire/adapter-sqlite/schema/room-access';
import { activitySchema } from '@crossfire/adapter-sqlite/schema/activity';
import { auditSchema } from '@crossfire/adapter-sqlite/schema/audit';
import { fleetControlSchema } from '@crossfire/adapter-sqlite/schema/fleet-control';
import { wakeUpSchema } from '@crossfire/adapter-sqlite/schema/wake-up';
import { ownerConversationSchema } from '@crossfire/adapter-sqlite/schema/owner-conversation';
import { runtimeSchema, runtimeObservationSchema } from '@crossfire/adapter-sqlite/schema/runtime';
import { statisticsSchema } from '@crossfire/adapter-sqlite/schema/statistics';
import { fleetPolicySchema } from '@crossfire/adapter-sqlite/schema/fleet-policy';
import { fleetRuntimeSchema } from '@crossfire/adapter-sqlite/schema/fleet-runtime';
import { seedReferenceData } from '@crossfire/adapter-sqlite/schema/reference-data';

const observation = `
CREATE TABLE runtime_observation (
 run_id TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agent(principal_id), session_id TEXT NOT NULL, room_id TEXT, runtime TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('idle','working','waiting-approval','waiting-answer','failed','unavailable')), observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
 history_mode TEXT NOT NULL CHECK(history_mode IN ('shared','per-room')), max_input_bytes INTEGER NOT NULL CHECK(max_input_bytes BETWEEN 1024 AND 4194304), error_message TEXT,
 PRIMARY KEY(run_id,session_id), FOREIGN KEY(run_id,agent_id) REFERENCES listener_run(id,agent_id)
) STRICT;
CREATE INDEX ix_runtime_observation_agent_time ON runtime_observation(agent_id,observed_at DESC,run_id);
`;

export function schema11Store(path = ':memory:') {
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.exec(identitySchema + authorizationSchema + enrollmentSchema + roomAccessSchema + activitySchema
    + auditSchema.replace('  fleet_idle_timeout_seconds INTEGER NOT NULL CHECK(fleet_idle_timeout_seconds BETWEEN 0 AND 604800),\n', '')
    + fleetControlSchema + wakeUpSchema + ownerConversationSchema + runtimeSchema.replace(runtimeObservationSchema, observation)
    + statisticsSchema + fleetPolicySchema + fleetRuntimeSchema);
  seedReferenceData(database);
  database.exec("DELETE FROM role_permission WHERE permission_code LIKE 'publication.%'; DELETE FROM permission WHERE code LIKE 'publication.%'; CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id,created_at DESC,id);");
  database.pragma('application_id = 1129465426'); database.pragma('user_version = 11');
  return database;
}
