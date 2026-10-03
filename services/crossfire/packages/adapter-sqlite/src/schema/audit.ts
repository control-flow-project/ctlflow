export const auditSchema = `
CREATE TABLE instance_policy (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  max_owner_agents INTEGER NOT NULL,
  max_agents INTEGER NOT NULL,
  max_pending INTEGER NOT NULL,
  enrollment_seconds INTEGER NOT NULL,
  reconcile_seconds INTEGER NOT NULL,
  max_message_bytes INTEGER NOT NULL CHECK(max_message_bytes BETWEEN 4096 AND 4194304),
  agent_instructions TEXT NOT NULL,
  signup_mode TEXT NOT NULL CHECK(signup_mode IN ('invitation','open')),
  invitation_issuers TEXT NOT NULL CHECK(invitation_issuers IN ('administrators','members')),
  PRIMARY KEY (id),
  CHECK(id = 'instance'),
  CHECK(revision >= 0),
  CHECK(max_owner_agents BETWEEN 1 AND 100),
  CHECK(max_agents BETWEEN max_owner_agents AND 1000),
  CHECK(max_pending BETWEEN 1 AND 1000),
  CHECK(enrollment_seconds BETWEEN 60 AND 3600),
  CHECK(reconcile_seconds BETWEEN 30 AND 3600),
  CHECK(length(CAST(agent_instructions AS BLOB)) <= 8192)
) STRICT;


CREATE TABLE audit_event (
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_credential_id TEXT,
  actor_kind TEXT NOT NULL,
  actor_principal_id TEXT,
  owner_id TEXT,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  room_id TEXT,
  membership_generation TEXT,
  authorizer_id TEXT,
  added_by_id TEXT,
  permission_code TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(actor_principal_id) REFERENCES principal(id),
  FOREIGN KEY(owner_id) REFERENCES member(principal_id),
  FOREIGN KEY(authorizer_id) REFERENCES principal(id),
  FOREIGN KEY(added_by_id) REFERENCES principal(id),
  FOREIGN KEY(permission_code) REFERENCES permission(code),
  CHECK(actor_kind IN ('human','agent','controller','system','anonymous')),
  CHECK((actor_kind IN ('human','agent')) = (actor_principal_id IS NOT NULL)),
  CHECK((actor_kind = 'controller') = (actor_credential_id IS NOT NULL)),
  CHECK(outcome IN ('accepted','rejected','applied','failed'))
) STRICT;
CREATE INDEX ix_audit_event_created ON audit_event(created_at DESC, id DESC);
CREATE INDEX ix_audit_event_actor ON audit_event(actor_principal_id, created_at DESC, id DESC);
CREATE INDEX ix_audit_event_owner ON audit_event(owner_id, created_at DESC, id DESC);
CREATE INDEX ix_audit_event_target ON audit_event(target_kind, target_id, created_at DESC, id DESC);
CREATE INDEX ix_audit_event_request ON audit_event(request_id, id);
`;
