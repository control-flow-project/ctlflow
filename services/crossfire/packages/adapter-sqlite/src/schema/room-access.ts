export const roomAccessSchema = `
CREATE TABLE agent_room_grant (
  agent_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  authorizer_id TEXT NOT NULL,
  added_by_id TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  power_level INTEGER,
  muted INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  access_revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, room_id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  FOREIGN KEY(authorizer_id) REFERENCES principal(id),
  FOREIGN KEY(added_by_id) REFERENCES principal(id),
  UNIQUE(agent_id, room_id, generation),
  CHECK(access_mode IN ('none','read','reply','custom')),
  CHECK((access_mode = 'custom') = (power_level IS NOT NULL)),
  CHECK(muted IN (0,1)),
  CHECK(revision >= 0 AND access_revision >= 0)
) STRICT;
CREATE INDEX ix_agent_room_grant_room ON agent_room_grant(room_id, agent_id);
CREATE INDEX ix_agent_room_grant_authorizer ON agent_room_grant(authorizer_id, agent_id, room_id);
CREATE INDEX ix_agent_room_grant_added_by ON agent_room_grant(added_by_id, agent_id, room_id);

CREATE TABLE agent_room_permission (
  agent_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  grant_scope TEXT NOT NULL,
  granted_by_member_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, room_id, permission_code),
  FOREIGN KEY(agent_id, room_id, generation) REFERENCES agent_room_grant(agent_id, room_id, generation),
  FOREIGN KEY(permission_code, grant_scope) REFERENCES permission(code, grant_scope),
  FOREIGN KEY(granted_by_member_id) REFERENCES member(principal_id),
  CHECK(grant_scope = 'agent_room')
) STRICT;
CREATE INDEX ix_agent_room_permission_permission ON agent_room_permission(permission_code, room_id, agent_id);
CREATE INDEX ix_agent_room_permission_grantor ON agent_room_permission(granted_by_member_id, agent_id, room_id);

CREATE TABLE room_grant_application (
  agent_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  observed_generation TEXT,
  applied_revision INTEGER,
  applied_access_revision INTEGER,
  membership TEXT,
  power_level INTEGER,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_check_at INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY (agent_id, room_id),
  FOREIGN KEY(agent_id, room_id) REFERENCES agent_room_grant(agent_id, room_id),
  CHECK(membership IS NULL OR membership IN ('join','leave','invite','ban'))
) STRICT;
CREATE INDEX ix_room_grant_application_due ON room_grant_application(next_check_at, agent_id, room_id);

CREATE TABLE agent_wake_sender (
  agent_id TEXT NOT NULL,
  sender_principal_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, sender_principal_id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  FOREIGN KEY(sender_principal_id) REFERENCES principal(id),
  CHECK(agent_id != sender_principal_id)
) STRICT;
CREATE INDEX ix_agent_wake_sender_sender ON agent_wake_sender(sender_principal_id, agent_id);
`;
