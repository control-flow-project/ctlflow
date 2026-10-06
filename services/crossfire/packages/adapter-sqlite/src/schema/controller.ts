export const enrollmentArchiveSchema = `
CREATE TABLE enrollment_archive (
  controller_name TEXT, controller_credential_hash TEXT, fleet_key TEXT,
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES member(principal_id), verification_code TEXT NOT NULL,
  claim_hash TEXT NOT NULL, roster_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
  revision INTEGER NOT NULL CHECK(revision >= 0), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  decided_by_member_id TEXT REFERENCES member(principal_id), decided_at INTEGER,
  CHECK((decided_by_member_id IS NULL) = (decided_at IS NULL)), CHECK(expires_at > created_at)
) STRICT;
CREATE INDEX ix_enrollment_archive_owner ON enrollment_archive(owner_id,created_at,id);
CREATE INDEX ix_enrollment_archive_decider ON enrollment_archive(decided_by_member_id,id);
CREATE TABLE enrollment_archive_item (
  request_id TEXT NOT NULL REFERENCES enrollment_archive(id), instance_key TEXT NOT NULL, requested_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('existing','claimed','failed')), agent_id TEXT REFERENCES agent(principal_id), failure_code TEXT,
  PRIMARY KEY(request_id,instance_key), CHECK((outcome = 'failed') = (failure_code IS NOT NULL)),
  CHECK(outcome != 'existing' OR agent_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_enrollment_archive_item_agent ON enrollment_archive_item(agent_id,request_id,instance_key);
CREATE TABLE enrollment_archive_policy (
  request_id TEXT NOT NULL, instance_key TEXT NOT NULL,
  wake_mode TEXT NOT NULL CHECK(wake_mode IN ('humans','everyone','selected')),
  expected_agent_revision INTEGER CHECK(expected_agent_revision IS NULL OR expected_agent_revision >= 0),
  PRIMARY KEY(request_id,instance_key),
  FOREIGN KEY(request_id,instance_key) REFERENCES enrollment_archive_item(request_id,instance_key)
) STRICT;
CREATE TABLE enrollment_archive_permission (
  request_id TEXT NOT NULL, instance_key TEXT NOT NULL,
  permission_code TEXT NOT NULL CHECK(permission_code = 'room.agent.invite'),
  grant_scope TEXT NOT NULL DEFAULT 'agent_room' CHECK(grant_scope = 'agent_room'),
  PRIMARY KEY(request_id,instance_key,permission_code),
  FOREIGN KEY(request_id,instance_key) REFERENCES enrollment_archive_policy(request_id,instance_key),
  FOREIGN KEY(permission_code,grant_scope) REFERENCES permission(code,grant_scope)
) STRICT;
CREATE INDEX ix_enrollment_archive_permission_code ON enrollment_archive_permission(permission_code,grant_scope,request_id,instance_key);
CREATE TABLE enrollment_archive_wake_sender (
  request_id TEXT NOT NULL, instance_key TEXT NOT NULL, sender_principal_id TEXT NOT NULL REFERENCES principal(id),
  include_agents INTEGER NOT NULL CHECK(include_agents IN (0,1)),
  PRIMARY KEY(request_id,instance_key,sender_principal_id),
  FOREIGN KEY(request_id,instance_key) REFERENCES enrollment_archive_policy(request_id,instance_key)
) STRICT;
CREATE INDEX ix_enrollment_archive_wake_sender_principal ON enrollment_archive_wake_sender(sender_principal_id,request_id,instance_key);
CREATE TABLE enrollment_archive_metadata (
  enrollment_id TEXT NOT NULL REFERENCES enrollment_archive(id), key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY(enrollment_id,key)
) STRICT;
`;

export const enrollmentArchiveGuards = ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
  'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'].map(table => `
CREATE TRIGGER protect_${table}_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;
CREATE TRIGGER protect_${table}_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;
`).join('');

export const controllerRunGuards = `
CREATE TRIGGER validate_listener_controller_insert BEFORE INSERT ON listener_run
WHEN NEW.controller_fleet_id IS NULL OR NOT EXISTS (
 SELECT 1 FROM fleet_instance AS instance JOIN fleet ON fleet.owner_id = instance.owner_id AND fleet.fleet_key = instance.fleet_key
 WHERE instance.agent_id = NEW.agent_id AND instance.retired_at IS NULL AND fleet.archived_at IS NULL AND fleet.id = NEW.controller_fleet_id
)
BEGIN SELECT RAISE(ABORT, 'Listener requires its authoritative fleet controller binding'); END;
CREATE TRIGGER protect_listener_controller_update BEFORE UPDATE ON listener_run
WHEN NEW.agent_id != OLD.agent_id OR NEW.controller_fleet_id IS NOT OLD.controller_fleet_id
 OR NEW.controller_connection_id IS NOT OLD.controller_connection_id OR NEW.controller_credential_id IS NOT OLD.controller_credential_id
BEGIN SELECT RAISE(ABORT, 'Listener controller generations are immutable'); END;
`;

export const nativeStopSchema = `
CREATE TABLE fleet_native_stop (
 agent_id TEXT NOT NULL REFERENCES agent(principal_id), receipt_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0),
 fleet_id TEXT NOT NULL REFERENCES fleet(id),
 run_id TEXT NOT NULL, connection_id TEXT NOT NULL, credential_id TEXT NOT NULL,
 native_stopped_at INTEGER NOT NULL, invalidated_at INTEGER,
 PRIMARY KEY(agent_id,receipt_id), UNIQUE(agent_id,sequence),
 FOREIGN KEY(run_id,agent_id) REFERENCES listener_run(id,agent_id),
 FOREIGN KEY(credential_id,fleet_id) REFERENCES fleet_credential(id,fleet_id)
) STRICT;
CREATE INDEX ix_fleet_native_stop_fleet ON fleet_native_stop(fleet_id,agent_id);
CREATE INDEX ix_fleet_native_stop_run ON fleet_native_stop(run_id,agent_id);
CREATE INDEX ix_fleet_native_stop_credential ON fleet_native_stop(credential_id,fleet_id);
`;
