export const statisticsSchema = `
CREATE TABLE listener_stat_checkpoint (
  run_id TEXT NOT NULL PRIMARY KEY REFERENCES listener_run(id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  digest TEXT NOT NULL,
  captured_at INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_listener_stat_checkpoint_retention ON listener_stat_checkpoint(captured_at);
CREATE TABLE listener_stat_interval (
  run_id TEXT NOT NULL REFERENCES listener_run(id),
  bucket_at INTEGER NOT NULL CHECK(bucket_at >= 0),
  agent_id TEXT NOT NULL REFERENCES agent(principal_id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL CHECK(ended_at >= started_at),
  captured_at INTEGER NOT NULL,
  dropped INTEGER NOT NULL CHECK(dropped >= 0),
  PRIMARY KEY(run_id, bucket_at)
) STRICT;
CREATE INDEX ix_listener_stat_interval_agent_captured ON listener_stat_interval(agent_id, captured_at, run_id, bucket_at);
CREATE INDEX ix_listener_stat_interval_retention ON listener_stat_interval(captured_at);
CREATE TABLE listener_stat_flow (
  run_id TEXT NOT NULL,
  bucket_at INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  sender_matrix_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  observed INTEGER NOT NULL CHECK(observed >= 0),
  delivered INTEGER NOT NULL CHECK(delivered >= 0),
  content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
  delivered_bytes INTEGER NOT NULL CHECK(delivered_bytes >= 0),
  attachment_bytes INTEGER NOT NULL CHECK(attachment_bytes >= 0),
  largest_bytes INTEGER NOT NULL CHECK(largest_bytes >= 0),
  PRIMARY KEY(run_id, bucket_at, room_id, sender_matrix_id, message_type),
  FOREIGN KEY(run_id, bucket_at) REFERENCES listener_stat_interval(run_id, bucket_at) ON DELETE CASCADE
) STRICT;
CREATE TABLE listener_stat_usage (
  run_id TEXT NOT NULL,
  bucket_at INTEGER NOT NULL,
  runtime TEXT NOT NULL,
  session_id TEXT NOT NULL,
  input INTEGER NOT NULL CHECK(input >= 0),
  cached_input INTEGER NOT NULL CHECK(cached_input >= 0),
  cache_write_input INTEGER CHECK(cache_write_input >= 0),
  output INTEGER NOT NULL CHECK(output >= 0),
  reasoning_output INTEGER NOT NULL CHECK(reasoning_output >= 0),
  total INTEGER NOT NULL CHECK(total >= 0),
  PRIMARY KEY(run_id, bucket_at, runtime, session_id),
  FOREIGN KEY(run_id, bucket_at) REFERENCES listener_stat_interval(run_id, bucket_at) ON DELETE CASCADE
) STRICT;
CREATE TABLE runtime_usage_checkpoint (
  agent_id TEXT NOT NULL REFERENCES agent(principal_id),
  runtime TEXT NOT NULL,
  session_id TEXT NOT NULL,
  input INTEGER NOT NULL,
  cached_input INTEGER NOT NULL,
  cache_write_input INTEGER,
  output INTEGER NOT NULL,
  reasoning_output INTEGER NOT NULL,
  total INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(agent_id, runtime, session_id)
) STRICT;
CREATE INDEX ix_runtime_usage_checkpoint_retention ON runtime_usage_checkpoint(captured_at);
`;
