import Database from 'better-sqlite3';
import * as historical from './schema12-data.js';
import { seedReferenceData } from '@ctlflow/crossfire-adapter-sqlite/schema/reference-data';

export function schema12Store(path = ':memory:') {
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.exec([historical.identity, historical.authorization, historical.enrollment, historical.roomAccess, historical.activity,
    historical.audit, historical.fleetControl, historical.wakeUp, historical.ownerConversation, historical.runtime,
    historical.statistics, historical.fleetPolicy, historical.fleetRuntime, historical.publication].join('\n'));
  seedReferenceData(database);
  database.exec(`
INSERT INTO permission VALUES('agent.listener.disconnect.owned','role','Disconnect owned listener');
INSERT INTO permission VALUES('agent.listener.disconnect.any','role','Disconnect any listener');
INSERT INTO role_permission VALUES('member','agent.listener.disconnect.owned','role');
INSERT INTO role_permission VALUES('administrator','agent.listener.disconnect.owned','role');
INSERT INTO role_permission VALUES('administrator','agent.listener.disconnect.any','role');
CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id,created_at DESC,id);
`);
  database.pragma('application_id = 1129465426'); database.pragma('user_version = 12');
  return database;
}
