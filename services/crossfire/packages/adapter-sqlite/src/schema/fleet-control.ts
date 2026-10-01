export const fleetControlSchema = `
CREATE UNIQUE INDEX uq_fleet_credential_id_fleet ON fleet_credential(id, fleet_id);
CREATE TABLE fleet_connection (
  fleet_id TEXT NOT NULL PRIMARY KEY REFERENCES fleet(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > last_seen_at),
  closed_at INTEGER,
  FOREIGN KEY(credential_id, fleet_id) REFERENCES fleet_credential(id, fleet_id)
) STRICT;
CREATE TABLE fleet_message (
  id TEXT NOT NULL PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleet(id) ON DELETE CASCADE,
  author_principal_id TEXT REFERENCES member(principal_id),
  author_credential_id TEXT,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4096),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  CHECK((author_principal_id IS NULL) != (author_credential_id IS NULL)),
  FOREIGN KEY(author_credential_id, fleet_id) REFERENCES fleet_credential(id, fleet_id)
) STRICT;
CREATE INDEX ix_fleet_message_fleet_created ON fleet_message(fleet_id, created_at DESC, id DESC);
CREATE TABLE fleet_message_delivery (
  message_id TEXT NOT NULL REFERENCES fleet_message(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agent(principal_id),
  status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed','skipped')),
  completed_at INTEGER,
  error_message TEXT,
  PRIMARY KEY(message_id, agent_id),
  CHECK((status = 'pending') = (completed_at IS NULL)),
  CHECK(status IN ('failed','skipped') OR error_message IS NULL)
) STRICT;
CREATE INDEX ix_fleet_message_delivery_pending ON fleet_message_delivery(status, message_id, agent_id);
`;
