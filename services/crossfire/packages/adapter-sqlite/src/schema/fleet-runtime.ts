export const fleetRuntimeSchema = `
CREATE TABLE fleet_runtime_operation (
  id TEXT NOT NULL PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleet(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agent(principal_id),
  author_principal_id TEXT NOT NULL REFERENCES member(principal_id),
  action TEXT NOT NULL CHECK(action IN ('start','stop','reset')),
  expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT CHECK(error_message IS NULL OR length(error_message) BETWEEN 1 AND 4096),
  connection_id TEXT,
  credential_id TEXT,
  FOREIGN KEY(credential_id, fleet_id) REFERENCES fleet_credential(id, fleet_id),
  CHECK((status IN ('succeeded','failed')) = (completed_at IS NOT NULL)),
  CHECK((status = 'failed') = (error_message IS NOT NULL)),
  CHECK((connection_id IS NULL) = (credential_id IS NULL)),
  CHECK(status != 'running' OR connection_id IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX uq_fleet_runtime_operation_active ON fleet_runtime_operation(fleet_id) WHERE status IN ('pending','running');
CREATE INDEX ix_fleet_runtime_operation_created ON fleet_runtime_operation(fleet_id, created_at DESC, id DESC);
CREATE INDEX ix_fleet_runtime_operation_agent ON fleet_runtime_operation(agent_id, created_at DESC);
CREATE INDEX ix_fleet_runtime_operation_author ON fleet_runtime_operation(author_principal_id);
CREATE INDEX ix_fleet_runtime_operation_credential ON fleet_runtime_operation(credential_id, fleet_id);
`;
