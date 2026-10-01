export const enrollmentSchema = `
CREATE TABLE enrollment_request (
  controller_name TEXT,
  controller_credential_hash TEXT,
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  fleet_key TEXT,
  verification_code TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  roster_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_by_member_id TEXT,
  decided_at INTEGER,
  PRIMARY KEY (id),
  FOREIGN KEY(owner_id) REFERENCES member(principal_id),
  FOREIGN KEY(decided_by_member_id) REFERENCES member(principal_id),
  UNIQUE(verification_code),
  CHECK((fleet_key IS NULL AND controller_name IS NULL AND controller_credential_hash IS NULL) OR (fleet_key IS NOT NULL AND controller_name IS NOT NULL AND controller_credential_hash IS NOT NULL)),
  CHECK(status IN ('pending','approved','rejected','expired')),
  CHECK(revision >= 0),
  CHECK(expires_at > created_at),
  CHECK((decided_by_member_id IS NULL) = (decided_at IS NULL))
) STRICT;
CREATE INDEX ix_enrollment_request_owner ON enrollment_request(owner_id, created_at, id);
CREATE INDEX ix_enrollment_request_created ON enrollment_request(created_at, id);
CREATE INDEX ix_enrollment_request_expiry ON enrollment_request(status, expires_at, id);

CREATE TABLE enrollment_item (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  requested_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  agent_id TEXT,
  failure_code TEXT,
  PRIMARY KEY (request_id, instance_key),
  FOREIGN KEY(request_id) REFERENCES enrollment_request(id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  CHECK(outcome IN ('existing','claimed','failed')),
  CHECK((outcome = 'failed') = (failure_code IS NOT NULL)),
  CHECK(outcome != 'existing' OR agent_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_enrollment_item_agent ON enrollment_item(agent_id, request_id, instance_key);

CREATE TABLE agent_name (
  name TEXT NOT NULL,
  request_id TEXT,
  instance_key TEXT,
  agent_id TEXT,
  PRIMARY KEY (name),
  UNIQUE(agent_id),
  UNIQUE(request_id, instance_key),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item(request_id, instance_key),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  CHECK((agent_id IS NOT NULL AND request_id IS NULL AND instance_key IS NULL) OR (agent_id IS NULL AND request_id IS NOT NULL AND instance_key IS NOT NULL))
) STRICT;


CREATE TABLE fleet (
  id TEXT NOT NULL UNIQUE,
  delivery_enabled INTEGER NOT NULL DEFAULT 1 CHECK(delivery_enabled IN (0,1)),
  label TEXT NOT NULL,
  controller_name TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  updated_at INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  fleet_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, fleet_key),
  FOREIGN KEY(owner_id) REFERENCES member(principal_id)
) STRICT;


CREATE TABLE fleet_instance (
  owner_id TEXT NOT NULL,
  fleet_key TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, fleet_key, instance_key),
  UNIQUE(agent_id),
  FOREIGN KEY(owner_id, fleet_key) REFERENCES fleet(owner_id, fleet_key) ON DELETE CASCADE,
  FOREIGN KEY(agent_id, owner_id) REFERENCES agent(principal_id, owner_id)
) STRICT;

CREATE TABLE fleet_credential (
  id TEXT NOT NULL,
  fleet_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (id),
  FOREIGN KEY(fleet_id) REFERENCES fleet(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE fleet_controller_metadata (
  fleet_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (fleet_id, key),
  FOREIGN KEY(fleet_id) REFERENCES fleet(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE enrollment_controller_metadata (
  enrollment_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, key),
  FOREIGN KEY(enrollment_id) REFERENCES enrollment_request(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ix_fleet_credential_fleet ON fleet_credential(fleet_id, revoked_at);
CREATE INDEX ix_fleet_created ON fleet(created_at, fleet_key);
`;
