export const enrollmentArchiveSchema = `
CREATE TABLE enrollment_archive (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES member(principal_id), verification_code TEXT NOT NULL,
  claim_hash TEXT NOT NULL, roster_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
  revision INTEGER NOT NULL CHECK(revision >= 0), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  decided_by_member_id TEXT REFERENCES member(principal_id), decided_at INTEGER,
  CHECK((decided_by_member_id IS NULL) = (decided_at IS NULL))
) STRICT;
CREATE INDEX ix_enrollment_archive_owner ON enrollment_archive(owner_id,created_at,id);
CREATE TABLE enrollment_archive_item (
  request_id TEXT NOT NULL REFERENCES enrollment_archive(id), instance_key TEXT NOT NULL, requested_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('existing','claimed','failed')), agent_id TEXT REFERENCES agent(principal_id), failure_code TEXT,
  PRIMARY KEY(request_id,instance_key), CHECK((outcome = 'failed') = (failure_code IS NOT NULL))
) STRICT;
CREATE INDEX ix_enrollment_archive_item_agent ON enrollment_archive_item(agent_id,request_id,instance_key);
`;

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
