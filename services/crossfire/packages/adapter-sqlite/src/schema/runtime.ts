export const runtimeSchema = `
CREATE UNIQUE INDEX ux_listener_run_agent_binding ON listener_run(id,agent_id);
CREATE INDEX ix_listener_run_agent_started ON listener_run(agent_id,started_at DESC,id DESC);
CREATE TABLE runtime_decision (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent(principal_id), run_id TEXT NOT NULL REFERENCES listener_run(id),
 runtime TEXT NOT NULL, session_id TEXT NOT NULL, request_id TEXT NOT NULL, turn_id TEXT NOT NULL, item_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('permission','question')), action TEXT NOT NULL, review_text TEXT NOT NULL,
 blocking INTEGER NOT NULL CHECK(blocking IN (0,1)), expires_at INTEGER CHECK(expires_at IS NULL OR expires_at >= 0), created_at INTEGER NOT NULL CHECK(created_at >= 0),
 status TEXT NOT NULL CHECK(status IN ('pending','answered','responded','cancelled','expired')),
 UNIQUE(run_id,session_id,request_id), FOREIGN KEY(run_id,agent_id) REFERENCES listener_run(id,agent_id)
) STRICT;
CREATE INDEX ix_runtime_decision_agent_created ON runtime_decision(agent_id,created_at DESC,id);
CREATE INDEX ix_runtime_decision_pending ON runtime_decision(status,expires_at,run_id);
CREATE TABLE runtime_decision_question (
 decision_id TEXT NOT NULL REFERENCES runtime_decision(id), question_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
 title TEXT NOT NULL, prompt TEXT NOT NULL, secret INTEGER NOT NULL CHECK(secret IN (0,1)), allow_text INTEGER NOT NULL CHECK(allow_text IN (0,1)),
 PRIMARY KEY(decision_id,question_id), UNIQUE(decision_id,position)
) STRICT;
CREATE TABLE runtime_decision_option (
 decision_id TEXT NOT NULL, question_id TEXT NOT NULL, option_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
 label TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(decision_id,question_id,option_id), UNIQUE(decision_id,question_id,position),
 FOREIGN KEY(decision_id,question_id) REFERENCES runtime_decision_question(decision_id,question_id)
) STRICT;
CREATE TABLE runtime_decision_answer (
 decision_id TEXT NOT NULL, question_id TEXT NOT NULL, option_id TEXT, answer_text TEXT,
 PRIMARY KEY(decision_id,question_id), CHECK((option_id IS NULL) != (answer_text IS NULL)),
 FOREIGN KEY(decision_id,question_id) REFERENCES runtime_decision_question(decision_id,question_id),
 FOREIGN KEY(decision_id,question_id,option_id) REFERENCES runtime_decision_option(decision_id,question_id,option_id)
) STRICT;
CREATE TABLE runtime_observation (
 run_id TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agent(principal_id), session_id TEXT NOT NULL, room_id TEXT, runtime TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('idle','working','waiting-approval','waiting-answer','failed','unavailable')), observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
 history_mode TEXT NOT NULL CHECK(history_mode IN ('shared','per-room')), max_input_bytes INTEGER NOT NULL CHECK(max_input_bytes BETWEEN 1024 AND 4194304), error_message TEXT,
 PRIMARY KEY(run_id,session_id), FOREIGN KEY(run_id,agent_id) REFERENCES listener_run(id,agent_id)
) STRICT;
CREATE INDEX ix_runtime_observation_agent_time ON runtime_observation(agent_id,observed_at DESC,run_id);
CREATE TABLE runtime_setting (
 run_id TEXT NOT NULL, session_id TEXT NOT NULL, name TEXT NOT NULL, configured_value TEXT, effective_value TEXT,
 PRIMARY KEY(run_id,session_id,name), FOREIGN KEY(run_id,session_id) REFERENCES runtime_observation(run_id,session_id)
) STRICT;
CREATE TABLE runtime_incident (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES member(principal_id), agent_id TEXT REFERENCES agent(principal_id), fleet_id TEXT REFERENCES fleet(id),
 run_id TEXT REFERENCES listener_run(id), session_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('failure','contact')), message TEXT NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at >= 0), recovered_at INTEGER CHECK(recovered_at IS NULL OR recovered_at >= created_at), CHECK((agent_id IS NULL) != (fleet_id IS NULL))
) STRICT;
CREATE INDEX ix_runtime_incident_active ON runtime_incident(recovered_at,owner_id,created_at,id);
CREATE UNIQUE INDEX ux_runtime_incident_agent_episode ON runtime_incident(agent_id,COALESCE(session_id,''),kind) WHERE recovered_at IS NULL AND agent_id IS NOT NULL;
CREATE UNIQUE INDEX ux_runtime_incident_fleet_episode ON runtime_incident(fleet_id,kind) WHERE recovered_at IS NULL AND fleet_id IS NOT NULL;
CREATE TABLE incident_notification (
 incident_id TEXT NOT NULL REFERENCES runtime_incident(id), phase TEXT NOT NULL CHECK(phase IN ('initial','recovery')),
 body TEXT NOT NULL, next_attempt_at INTEGER NOT NULL CHECK(next_attempt_at >= 0), event_id TEXT, PRIMARY KEY(incident_id,phase)
) STRICT;
CREATE INDEX ix_incident_notification_pending ON incident_notification(event_id,next_attempt_at,incident_id);
CREATE TABLE management_conversation (
 owner_id TEXT PRIMARY KEY REFERENCES member(principal_id), room_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;
CREATE TRIGGER validate_management_conversation BEFORE INSERT ON management_conversation
WHEN EXISTS (SELECT 1 FROM agent_room_grant WHERE room_id = NEW.room_id AND access_mode != 'none')
 OR EXISTS (SELECT 1 FROM agent_owner_conversation WHERE room_id = NEW.room_id)
 OR EXISTS (SELECT 1 FROM agent_room_permission WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot admit agents'); END;
CREATE TRIGGER protect_management_conversation_binding BEFORE UPDATE ON management_conversation
BEGIN SELECT RAISE(ABORT, 'Management conversation bindings are immutable'); END;
CREATE TRIGGER protect_management_conversation_owner_insert BEFORE INSERT ON agent_owner_conversation
WHEN EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot admit agents'); END;
CREATE TRIGGER protect_management_conversation_owner_update BEFORE UPDATE ON agent_owner_conversation
WHEN EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot admit agents'); END;
CREATE TRIGGER protect_management_conversation_grant_insert BEFORE INSERT ON agent_room_grant
WHEN NEW.access_mode != 'none' AND EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot admit agents'); END;
CREATE TRIGGER protect_management_conversation_grant_update BEFORE UPDATE ON agent_room_grant
WHEN NEW.access_mode != 'none' AND EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot admit agents'); END;
CREATE TRIGGER protect_management_conversation_permission_insert BEFORE INSERT ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot delegate invitations'); END;
CREATE TRIGGER protect_management_conversation_permission_update BEFORE UPDATE ON agent_room_permission
WHEN EXISTS (SELECT 1 FROM management_conversation WHERE room_id = NEW.room_id)
BEGIN SELECT RAISE(ABORT, 'Management conversations cannot delegate invitations'); END;
`;
