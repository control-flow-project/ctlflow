import { openTestStore } from './storage.js';
import { restoreSchema14EnrollmentItems } from './schema14.js';
import { restoreSchema16Logging } from './schema16.js';
import { migrationChange, migrationQuery } from './migration-data.js';

export const schema13Tables = ["agent","agent_wake_sender","enrollment_item_policy","enrollment_item_wake_sender","enrollment_archive_policy","enrollment_archive_wake_sender"];
export const schema13Wake = `
CREATE TABLE agent (
  principal_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  display_name_override TEXT,
  wake_mode TEXT NOT NULL,
  PRIMARY KEY (principal_id),
  CHECK(principal_kind = 'agent'),
  FOREIGN KEY(principal_id, principal_kind) REFERENCES principal(id, kind),
  FOREIGN KEY(owner_id) REFERENCES member(principal_id),
  UNIQUE(principal_id, owner_id),
  CHECK(wake_mode IN ('nobody','owner','owner-agents','humans','everyone','selected'))
) STRICT;
CREATE INDEX ix_agent_owner ON agent(owner_id, principal_id);
CREATE TABLE agent_wake_sender (
  agent_id TEXT NOT NULL,
  sender_principal_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, sender_principal_id),
  FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
  FOREIGN KEY(sender_principal_id) REFERENCES principal(id),
  CHECK(agent_id != sender_principal_id)
) STRICT;
CREATE INDEX ix_agent_wake_sender_sender ON agent_wake_sender(sender_principal_id, agent_id);
CREATE TABLE enrollment_item_policy (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  wake_mode TEXT NOT NULL CHECK(wake_mode IN ('nobody','owner','owner-agents','humans','everyone','selected')),
  expected_agent_revision INTEGER CHECK(expected_agent_revision IS NULL OR expected_agent_revision >= 0),
  PRIMARY KEY(request_id, instance_key),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item(request_id, instance_key) ON DELETE CASCADE
) STRICT;
CREATE TABLE enrollment_item_wake_sender (
  request_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  sender_principal_id TEXT NOT NULL,
  PRIMARY KEY(request_id, instance_key, sender_principal_id),
  FOREIGN KEY(request_id, instance_key) REFERENCES enrollment_item_policy(request_id, instance_key) ON DELETE CASCADE,
  FOREIGN KEY(sender_principal_id) REFERENCES principal(id)
) STRICT;
CREATE INDEX ix_enrollment_item_wake_sender_principal ON enrollment_item_wake_sender(sender_principal_id, request_id, instance_key);
CREATE TABLE enrollment_archive_policy (
  request_id TEXT NOT NULL, instance_key TEXT NOT NULL,
  wake_mode TEXT NOT NULL CHECK(wake_mode IN ('nobody','owner','owner-agents','humans','everyone','selected')),
  expected_agent_revision INTEGER CHECK(expected_agent_revision IS NULL OR expected_agent_revision >= 0),
  PRIMARY KEY(request_id,instance_key),
  FOREIGN KEY(request_id,instance_key) REFERENCES enrollment_archive_item(request_id,instance_key)
) STRICT;
CREATE TABLE enrollment_archive_wake_sender (
  request_id TEXT NOT NULL, instance_key TEXT NOT NULL, sender_principal_id TEXT NOT NULL REFERENCES principal(id),
  PRIMARY KEY(request_id,instance_key,sender_principal_id),
  FOREIGN KEY(request_id,instance_key) REFERENCES enrollment_archive_policy(request_id,instance_key)
) STRICT;
CREATE INDEX ix_enrollment_archive_wake_sender_principal ON enrollment_archive_wake_sender(sender_principal_id,request_id,instance_key);
`;

export function schema13Store() {
  const database = openTestStore();
  database.pragma('foreign_keys = ON');
  restoreSchema16Logging(database);
  restoreSchema14EnrollmentItems(database);
  database.pragma('foreign_keys = OFF');
  for (const table of schema13Tables) migrationChange(database, migrationQuery.schema.dropTable(table));
  database.exec(schema13Wake);
  for (const table of ['enrollment_archive_policy', 'enrollment_archive_wake_sender']) {
    for (const action of ['UPDATE', 'DELETE']) database.exec('CREATE TRIGGER protect_' + table + '_' + action.toLowerCase()
      + ' BEFORE ' + action + ' ON ' + table + " BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;");
  }
  database.pragma('user_version = 13');
  database.pragma('foreign_keys = ON');
  return database;
}
