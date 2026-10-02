export const wakeUpSchema = `
CREATE TABLE wake_rule (
  id TEXT NOT NULL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES member(principal_id),
  configured_by_id TEXT NOT NULL REFERENCES member(principal_id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK(length(trim(message)) > 0 AND length(CAST(message AS BLOB)) <= 16384),
  schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('interval','cron')),
  interval_seconds INTEGER CHECK(interval_seconds BETWEEN 1 AND 31536000),
  cron_expression TEXT CHECK(length(cron_expression) BETWEEN 1 AND 200),
  time_zone TEXT CHECK(length(time_zone) BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((schedule_kind = 'interval' AND interval_seconds IS NOT NULL AND cron_expression IS NULL AND time_zone IS NULL)
    OR (schedule_kind = 'cron' AND interval_seconds IS NULL AND cron_expression IS NOT NULL AND time_zone IS NOT NULL))
) STRICT;
CREATE INDEX ix_wake_rule_owner_created ON wake_rule(owner_id, created_at DESC, id, name);
CREATE INDEX ix_wake_rule_created ON wake_rule(created_at DESC, id, name);
CREATE TABLE wake_rule_agent (
  rule_id TEXT NOT NULL REFERENCES wake_rule(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agent(principal_id),
  next_due_at INTEGER NOT NULL,
  last_delivered_at INTEGER,
  PRIMARY KEY(rule_id, agent_id)
) STRICT;
CREATE INDEX ix_wake_rule_agent_due ON wake_rule_agent(agent_id, next_due_at, rule_id);
CREATE TABLE wake_delivery (
  id TEXT NOT NULL PRIMARY KEY,
  rule_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  rule_revision INTEGER NOT NULL CHECK(rule_revision >= 0),
  run_id TEXT NOT NULL REFERENCES listener_run(id),
  session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 1 AND 200),
  scheduled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','delivered','cancelled')),
  delivered_at INTEGER,
  FOREIGN KEY(rule_id, agent_id) REFERENCES wake_rule_agent(rule_id, agent_id) ON DELETE CASCADE,
  CHECK((status = 'delivered') = (delivered_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX uq_wake_delivery_pending_agent ON wake_delivery(agent_id) WHERE status = 'pending';
CREATE INDEX ix_wake_delivery_rule_created ON wake_delivery(rule_id, created_at DESC, id);
CREATE INDEX ix_wake_delivery_agent_created ON wake_delivery(agent_id, created_at DESC, id);
`;
