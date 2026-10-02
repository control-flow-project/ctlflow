export const ownerConversationSchema = `
CREATE TABLE agent_owner_conversation (
  agent_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id),
  UNIQUE(room_id),
  FOREIGN KEY(agent_id, owner_id) REFERENCES agent(principal_id, owner_id),
  FOREIGN KEY(agent_id, room_id) REFERENCES agent_room_grant(agent_id, room_id)
) STRICT;
CREATE INDEX ix_agent_owner_conversation_owner ON agent_owner_conversation(owner_id, agent_id);
CREATE TRIGGER validate_owner_conversation BEFORE INSERT ON agent_owner_conversation
WHEN NOT EXISTS (SELECT 1 FROM agent_room_grant WHERE agent_id = NEW.agent_id AND room_id = NEW.room_id
  AND access_mode = 'reply' AND power_level IS NULL AND muted = 0
  AND authorizer_id = NEW.owner_id AND added_by_id = NEW.owner_id)
  OR EXISTS (SELECT 1 FROM agent_room_permission WHERE agent_id = NEW.agent_id AND room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations require permanent owner-authorized read and reply'); END;
CREATE TRIGGER protect_owner_conversation BEFORE UPDATE ON agent_room_grant
WHEN EXISTS (SELECT 1 FROM agent_owner_conversation WHERE agent_id = OLD.agent_id AND room_id = OLD.room_id
  AND (NEW.access_mode != 'reply' OR NEW.power_level IS NOT NULL OR NEW.muted != 0
    OR NEW.authorizer_id != owner_id OR NEW.added_by_id != owner_id))
BEGIN SELECT RAISE(ABORT, 'Owner conversation access cannot be disabled or delegated'); END;
CREATE TRIGGER protect_owner_conversation_permission_insert BEFORE INSERT ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM agent_owner_conversation WHERE agent_id = NEW.agent_id AND room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations cannot delegate invitations'); END;
CREATE TRIGGER protect_owner_conversation_permission_update BEFORE UPDATE ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM agent_owner_conversation WHERE agent_id = NEW.agent_id AND room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations cannot delegate invitations'); END;
`;
