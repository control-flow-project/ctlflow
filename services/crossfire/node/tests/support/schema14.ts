import type Database from 'better-sqlite3';
import { migrationChange, migrationQuery, migrationRows } from './migration-data.js';

export function restoreSchema14EnrollmentItems(database: Database.Database): void {
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(`CREATE TABLE enrollment_item_previous (
        request_id TEXT NOT NULL, instance_key TEXT NOT NULL, requested_name TEXT NOT NULL, outcome TEXT NOT NULL,
        agent_id TEXT, failure_code TEXT, PRIMARY KEY(request_id,instance_key),
        FOREIGN KEY(request_id) REFERENCES enrollment_request(id), FOREIGN KEY(agent_id) REFERENCES agent(principal_id),
        CHECK(outcome IN ('existing','claimed','failed')), CHECK((outcome='failed')=(failure_code IS NOT NULL)),
        CHECK(outcome!='existing' OR agent_id IS NOT NULL)
      ) STRICT;`);
      const rows = migrationRows(database, migrationQuery('enrollment_item').select('request_id', 'instance_key', 'requested_name', 'outcome', 'agent_id'));
      if (rows.length) migrationChange(database, migrationQuery('enrollment_item_previous').insert(rows.map(row => ({ ...row, failure_code: null }))));
      migrationChange(database, migrationQuery.schema.dropTable('enrollment_item'));
      const rename = migrationQuery.schema;
      rename.renameTable('enrollment_item_previous', 'enrollment_item');
      migrationChange(database, rename);
      migrationChange(database, migrationQuery.schema.alterTable('enrollment_item', table => table.index(['agent_id', 'request_id', 'instance_key'], 'ix_enrollment_item_agent')));
    }).immediate();
  } finally { database.pragma('foreign_keys = ' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
