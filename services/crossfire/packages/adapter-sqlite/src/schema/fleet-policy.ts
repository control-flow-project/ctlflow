export const fleetPolicySchema = `
CREATE TABLE enrollment_item_policy (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  wake_mode TEXT NOT NULL CHECK(wake_mode IN ('nobody','owner','owner-agents','humans','everyone','selected')),
  expected_agent_revision INTEGER CHECK(expected_agent_revision IS NULL OR expected_agent_revision >= 0),
  PRIMARY KEY(request_id, instance_key),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item(request_id, instance_key) ON DELETE CASCADE
) STRICT;
CREATE TABLE enrollment_item_permission (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  permission_code TEXT NOT NULL CHECK(permission_code = 'room.agent.invite'),
  grant_scope TEXT NOT NULL DEFAULT 'agent_room' CHECK(grant_scope = 'agent_room'),
  PRIMARY KEY(request_id, instance_key, permission_code),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item_policy(request_id, instance_key) ON DELETE CASCADE,
  FOREIGN KEY(permission_code, grant_scope) REFERENCES permission(code, grant_scope)
) STRICT;
CREATE INDEX ix_enrollment_item_permission_code ON enrollment_item_permission(permission_code, grant_scope, request_id, instance_key);
CREATE TABLE enrollment_item_wake_sender (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  sender_principal_id TEXT NOT NULL,
  PRIMARY KEY(request_id, instance_key, sender_principal_id),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item_policy(request_id, instance_key) ON DELETE CASCADE,
  FOREIGN KEY(sender_principal_id) REFERENCES principal(id)
) STRICT;
CREATE INDEX ix_enrollment_item_wake_sender_principal ON enrollment_item_wake_sender(sender_principal_id, request_id, instance_key);
CREATE TABLE fleet_instance_policy (
  agent_id TEXT NOT NULL PRIMARY KEY,
  approved_by_member_id TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES fleet_instance(agent_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id, approved_by_member_id) REFERENCES agent(principal_id, owner_id),
  FOREIGN KEY(approved_by_member_id) REFERENCES member(principal_id)
) STRICT;
CREATE INDEX ix_fleet_instance_policy_owner ON fleet_instance_policy(approved_by_member_id, agent_id);
CREATE TABLE fleet_instance_permission (
  agent_id TEXT NOT NULL,
  permission_code TEXT NOT NULL CHECK(permission_code = 'room.agent.invite'),
  grant_scope TEXT NOT NULL DEFAULT 'agent_room' CHECK(grant_scope = 'agent_room'),
  PRIMARY KEY(agent_id, permission_code),
  FOREIGN KEY(agent_id) REFERENCES fleet_instance_policy(agent_id) ON DELETE CASCADE,
  FOREIGN KEY(permission_code, grant_scope) REFERENCES permission(code, grant_scope)
) STRICT;
CREATE INDEX ix_fleet_instance_permission_code ON fleet_instance_permission(permission_code, grant_scope, agent_id);
`;
