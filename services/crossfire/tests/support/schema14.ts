import type Database from 'better-sqlite3';

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
      ) STRICT;
      INSERT INTO enrollment_item_previous SELECT request_id,instance_key,requested_name,outcome,agent_id,NULL FROM enrollment_item;
      DROP TABLE enrollment_item; ALTER TABLE enrollment_item_previous RENAME TO enrollment_item;
      CREATE INDEX ix_enrollment_item_agent ON enrollment_item(agent_id,request_id,instance_key);`);
    }).immediate();
  } finally { database.pragma('foreign_keys = ' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
