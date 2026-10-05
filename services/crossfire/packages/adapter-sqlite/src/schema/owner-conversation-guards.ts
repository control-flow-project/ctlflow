export const ownerConversationGuards = `
CREATE TRIGGER validate_owner_conversation BEFORE INSERT ON agent_owner_conversation
WHEN NOT EXISTS (SELECT 1 FROM agent_room_grant WHERE agent_id = NEW.agent_id AND room_id = NEW.room_id
  AND access_mode = 'reply' AND power_level IS NULL AND muted = 0
  AND authorizer_id = NEW.owner_id AND added_by_id = NEW.owner_id)
  OR EXISTS (SELECT 1 FROM agent_room_grant WHERE room_id = NEW.room_id AND agent_id != NEW.agent_id AND access_mode != 'none')
  OR EXISTS (SELECT 1 FROM agent_room_permission WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations require exclusive permanent owner-authorized read and reply'); END;
CREATE TRIGGER protect_owner_conversation_participant_insert BEFORE INSERT ON agent_room_grant
WHEN NEW.access_mode != 'none' AND EXISTS (SELECT 1 FROM agent_owner_conversation WHERE room_id = NEW.room_id AND agent_id != NEW.agent_id)
BEGIN SELECT RAISE(ABORT, 'Another agent cannot join a private owner conversation'); END;
CREATE TRIGGER protect_owner_conversation_participant_update BEFORE UPDATE ON agent_room_grant
WHEN NEW.access_mode != 'none' AND EXISTS (SELECT 1 FROM agent_owner_conversation WHERE room_id = NEW.room_id AND agent_id != NEW.agent_id)
BEGIN SELECT RAISE(ABORT, 'Another agent cannot join a private owner conversation'); END;
CREATE TRIGGER protect_owner_conversation_permission_insert BEFORE INSERT ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM agent_owner_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations cannot delegate invitations'); END;
CREATE TRIGGER protect_owner_conversation_permission_update BEFORE UPDATE ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM agent_owner_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Owner conversations cannot delegate invitations'); END;
`;
