export const activitySchema = `
CREATE TABLE member_invitation (
  id TEXT NOT NULL,
  created_by_member_id TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  role_code TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by_member_id TEXT,
  revoked_at INTEGER,
  claim_matrix_user_id TEXT,
  claim_display_name TEXT,
  claim_fingerprint TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY(created_by_member_id) REFERENCES member(principal_id),
  FOREIGN KEY(consumed_by_member_id) REFERENCES member(principal_id),
  FOREIGN KEY(role_code, principal_kind) REFERENCES role(code, principal_kind),
  CHECK(principal_kind = 'human'),
  UNIQUE(claim_matrix_user_id),
  CHECK((claim_matrix_user_id IS NULL AND claim_display_name IS NULL AND claim_fingerprint IS NULL) OR (claim_matrix_user_id IS NOT NULL AND claim_display_name IS NOT NULL AND claim_fingerprint IS NOT NULL))
) STRICT;
CREATE INDEX ix_member_invitation_created ON member_invitation(created_at, id);
CREATE INDEX ix_member_invitation_expiry ON member_invitation(expires_at, id);

CREATE TABLE member_session (
  secret_hash TEXT NOT NULL,
  member_id TEXT NOT NULL,
  csrf_secret TEXT NOT NULL,
  native_access_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (secret_hash),
  FOREIGN KEY(member_id) REFERENCES member(principal_id),
  CHECK(expires_at > created_at)
) STRICT;
CREATE INDEX ix_member_session_member ON member_session(member_id, expires_at);
CREATE INDEX ix_member_session_expiry ON member_session(expires_at);

CREATE TABLE listener_run (
  controller_fleet_id TEXT,
  controller_connection_id TEXT,
  controller_credential_id TEXT,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  release TEXT,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  messages_delivered INTEGER NOT NULL,
  stopped_at INTEGER,
  disconnect_requested_at INTEGER,
  PRIMARY KEY (id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  FOREIGN KEY(controller_fleet_id) REFERENCES fleet(id),
  FOREIGN KEY(controller_credential_id, controller_fleet_id) REFERENCES fleet_credential(id, fleet_id),
  CHECK((controller_fleet_id IS NOT NULL AND controller_connection_id IS NOT NULL AND controller_credential_id IS NOT NULL)
    OR (controller_fleet_id IS NULL AND controller_connection_id IS NULL AND controller_credential_id IS NULL AND stopped_at IS NOT NULL)),
  CHECK(active_ms >= 0 AND messages_delivered >= 0),
  CHECK(last_seen_at >= started_at)
) STRICT;
CREATE INDEX ix_listener_run_agent ON listener_run(agent_id, last_seen_at DESC, id);
CREATE INDEX ix_listener_run_active ON listener_run(last_seen_at, agent_id, id) WHERE stopped_at IS NULL;
CREATE INDEX ix_listener_run_controller ON listener_run(controller_fleet_id,controller_connection_id,agent_id) WHERE stopped_at IS NULL;

CREATE TABLE wake_notice (
  receiver_agent_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sender_matrix_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  reserved_at INTEGER NOT NULL,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_at INTEGER,
  native_event_id TEXT,
  next_attempt_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (receiver_agent_id, event_id),
  FOREIGN KEY(receiver_agent_id) REFERENCES agent(principal_id),
  CHECK(status IN ('pending','sent','denied')),
  CHECK((status = 'sent') = (sent_at IS NOT NULL AND native_event_id IS NOT NULL))
) STRICT;
CREATE INDEX ix_wake_notice_sender ON wake_notice(receiver_agent_id, sender_matrix_id, reserved_at DESC);
CREATE UNIQUE INDEX ix_wake_notice_pending_sender ON wake_notice(receiver_agent_id, sender_matrix_id) WHERE status = 'pending';
CREATE INDEX ix_wake_notice_due ON wake_notice(status, next_attempt_at);
`;
