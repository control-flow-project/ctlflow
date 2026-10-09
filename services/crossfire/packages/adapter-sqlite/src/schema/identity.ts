export const identitySchema = `
CREATE TABLE principal (
  id TEXT NOT NULL,
  matrix_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id),
  UNIQUE(matrix_user_id),
  UNIQUE(id, kind),
  CHECK(kind IN ('human','agent')),
  CHECK(status IN ('active','suspended','revoked')),
  CHECK(revision >= 0)
) STRICT;
CREATE INDEX ix_principal_kind_status ON principal(kind, status, id);

CREATE TABLE member (
  principal_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (principal_id),
  CHECK(principal_kind = 'human'),
  FOREIGN KEY(principal_id, principal_kind) REFERENCES principal(id, kind)
) STRICT;


CREATE TABLE agent (
  principal_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  wake_mode TEXT NOT NULL,
  PRIMARY KEY (principal_id),
  CHECK(principal_kind = 'agent'),
  FOREIGN KEY(principal_id, principal_kind) REFERENCES principal(id, kind),
  FOREIGN KEY(owner_id) REFERENCES member(principal_id),
  UNIQUE(principal_id, owner_id),
  CHECK(wake_mode IN ('humans','everyone','selected'))
) STRICT;
CREATE INDEX ix_agent_owner ON agent(owner_id, principal_id);

CREATE TABLE agent_credential (
  agent_id TEXT NOT NULL,
  provisioning_password TEXT NOT NULL,
  access_token TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id)
) STRICT;


CREATE TABLE principal_application (
  principal_id TEXT NOT NULL,
  applied_revision INTEGER,
  applied_intent_hash TEXT,
  applied_status TEXT,
  native_display_name TEXT,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_check_at INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY (principal_id),
  FOREIGN KEY(principal_id) REFERENCES principal(id),
  CHECK(applied_status IS NULL OR applied_status IN ('active','suspended','revoked'))
) STRICT;
CREATE INDEX ix_principal_application_due ON principal_application(next_check_at, principal_id);
`;
