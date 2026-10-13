import type Database from 'better-sqlite3';

export const loggingSchema = `
CREATE INDEX ix_listener_run_retention ON listener_run(last_seen_at,id);
CREATE INDEX ix_runtime_decision_retention ON runtime_decision(created_at,id);
CREATE INDEX ix_runtime_incident_retention ON runtime_incident(recovered_at,id);
CREATE INDEX ix_wake_notice_retention ON wake_notice(status,reserved_at,receiver_agent_id,event_id);
CREATE INDEX ix_fleet_runtime_operation_retention ON fleet_runtime_operation(status,completed_at,id);
CREATE INDEX ix_fleet_message_retention ON fleet_message(expires_at,id);
CREATE INDEX ix_member_invitation_retention ON member_invitation(expires_at,id);
CREATE INDEX ix_native_stop_retention ON fleet_native_stop(native_stopped_at,agent_id,receipt_id);
CREATE INDEX ix_runtime_decision_run ON runtime_decision(run_id,id);
CREATE INDEX ix_wake_delivery_run ON wake_delivery(run_id,id);
CREATE INDEX ix_runtime_incident_run ON runtime_incident(run_id,id);
CREATE INDEX ix_session_stop_state ON fleet_runtime_operation(fleet_id,agent_id,action,status,completed_at DESC,id DESC);
`;

export function migrateLoggingSchema(database: Database.Database): void {
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    database.exec('DROP TRIGGER IF EXISTS protect_' + table + '_delete;');
  database.exec(loggingSchema);
  database.pragma('user_version = 17');
}
