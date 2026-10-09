import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSchema, SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { agentChange } from '@ctlflow/crossfire-contracts/schema/request';
import { restoreSchema14EnrollmentItems } from './support/schema14.js';

test('schema 14 preserves identity and private state while retiring independent labels into audit', () => {
  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys=ON'); createSchema(database);
    restoreSchema14EnrollmentItems(database);
    database.exec(`ALTER TABLE agent ADD COLUMN display_name_override TEXT;
      INSERT INTO principal VALUES('owner','@owner:test','human','active',4,1),('agent','@agent:test','agent','active',7,1);
      INSERT INTO member VALUES('owner','human','Owner');
      INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode,display_name_override) VALUES('agent','agent','owner','selected','Ambiguous caption');
      INSERT INTO agent_name VALUES('registered',NULL,NULL,'agent');
      INSERT INTO agent_credential VALUES('agent','private-password','private-token',1);`);
    database.pragma('user_version=14');
    const identities = database.prepare('SELECT * FROM principal ORDER BY id').all();
    const credentials = database.prepare('SELECT * FROM agent_credential').all();
    createSchema(database);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.deepEqual(database.prepare('SELECT * FROM principal ORDER BY id').all(), identities);
    assert.deepEqual(database.prepare('SELECT * FROM agent_credential').all(), credentials);
    assert.deepEqual(database.prepare('SELECT name,agent_id FROM agent_name').all(), [{ name: 'registered', agent_id: 'agent' }]);
    assert.deepEqual(database.prepare('SELECT * FROM agent').all(), [{ principal_id: 'agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected' }]);
    assert.deepEqual(database.prepare('SELECT target_id,action,message FROM audit_event').all(),
      [{ target_id: 'agent', action: 'agent.name.canonicalized', message: '{"retiredDisplayName":"Ambiguous caption"}' }]);
    assert.throws(() => database.exec("UPDATE agent SET display_name_override='registered'"), /no such column/u);
    createSchema(database); assert.equal(database.prepare<[], { count: number }>('SELECT count(*) AS count FROM audit_event').get()?.count, 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(agentChange({ expectedRevision: 7, displayName: 'Another caption' }).ok, false);
  } finally { database.close(); }
});
