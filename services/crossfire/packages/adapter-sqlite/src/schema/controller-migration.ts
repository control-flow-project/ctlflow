import type Database from 'better-sqlite3';
import { activitySchema } from './activity.js';
import { enrollmentSchema } from './enrollment.js';
import { controllerRunGuards, enrollmentArchiveSchema, nativeStopSchema } from './controller.js';

export function migrateControllerSchema(database: Database.Database): void {
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(enrollmentArchiveSchema + `
ALTER TABLE fleet ADD COLUMN archived_at INTEGER;
ALTER TABLE fleet_instance ADD COLUMN retired_at INTEGER;
INSERT INTO enrollment_archive SELECT id,owner_id,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at
 FROM enrollment_request WHERE fleet_key IS NULL;
INSERT INTO enrollment_archive_item SELECT item.* FROM enrollment_item AS item JOIN enrollment_archive AS archive ON archive.id = item.request_id;
DELETE FROM agent_name WHERE request_id IN (SELECT id FROM enrollment_archive);
DELETE FROM enrollment_item_wake_sender WHERE request_id IN (SELECT id FROM enrollment_archive);
DELETE FROM enrollment_item_permission WHERE request_id IN (SELECT id FROM enrollment_archive);
DELETE FROM enrollment_item_policy WHERE request_id IN (SELECT id FROM enrollment_archive);
DELETE FROM enrollment_controller_metadata WHERE enrollment_id IN (SELECT id FROM enrollment_archive);
DELETE FROM enrollment_item WHERE request_id IN (SELECT id FROM enrollment_archive);
DELETE FROM role_permission WHERE permission_code IN ('agent.listener.disconnect.owned','agent.listener.disconnect.any');
DELETE FROM permission WHERE code IN ('agent.listener.disconnect.owned','agent.listener.disconnect.any');
`);
      const requestSchema = enrollmentSchema.slice(enrollmentSchema.indexOf('CREATE TABLE enrollment_request'), enrollmentSchema.indexOf('CREATE TABLE enrollment_item'));
      database.exec(requestSchema.replaceAll('enrollment_request', 'enrollment_request_next') + `
INSERT INTO enrollment_request_next SELECT * FROM enrollment_request WHERE fleet_key IS NOT NULL;
DROP TABLE enrollment_request;
ALTER TABLE enrollment_request_next RENAME TO enrollment_request;
DROP INDEX ix_enrollment_request_next_owner;
DROP INDEX ix_enrollment_request_next_created;
DROP INDEX ix_enrollment_request_next_expiry;
CREATE INDEX ix_enrollment_request_owner ON enrollment_request(owner_id,created_at,id);
CREATE INDEX ix_enrollment_request_created ON enrollment_request(created_at,id);
CREATE INDEX ix_enrollment_request_expiry ON enrollment_request(status,expires_at,id);
CREATE UNIQUE INDEX ux_fleet_credential_binding ON fleet_credential(id,fleet_id);
`);
      const runSchema = activitySchema.slice(activitySchema.indexOf('CREATE TABLE listener_run'), activitySchema.indexOf('CREATE TABLE wake_notice'));
      database.exec(runSchema.replaceAll('listener_run', 'listener_run_next') + `
INSERT INTO listener_run_next(controller_fleet_id,controller_connection_id,controller_credential_id,id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,stopped_at,disconnect_requested_at)
 SELECT NULL,NULL,NULL,id,agent_id,release,started_at,last_seen_at,active_ms,messages_delivered,COALESCE(stopped_at,last_seen_at),disconnect_requested_at FROM listener_run;
DROP TABLE listener_run;
ALTER TABLE listener_run_next RENAME TO listener_run;
DROP INDEX ix_listener_run_next_agent;
DROP INDEX ix_listener_run_next_active;
DROP INDEX ix_listener_run_next_controller;
CREATE INDEX ix_listener_run_agent ON listener_run(agent_id,last_seen_at DESC,id);
CREATE INDEX ix_listener_run_active ON listener_run(last_seen_at,agent_id,id) WHERE stopped_at IS NULL;
CREATE INDEX ix_listener_run_controller ON listener_run(controller_fleet_id,controller_connection_id,agent_id) WHERE stopped_at IS NULL;
CREATE UNIQUE INDEX ux_listener_run_agent_binding ON listener_run(id,agent_id);
CREATE INDEX ix_listener_run_agent_started ON listener_run(agent_id,started_at DESC,id DESC);
` + controllerRunGuards + nativeStopSchema);
      const violations = database.pragma('foreign_key_check');
      if (!Array.isArray(violations) || violations.length !== 0) throw new Error('Controller migration would violate retained relational history');
      database.pragma('user_version = 13');
    }).immediate();
  } finally { database.pragma('foreign_keys = ' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
