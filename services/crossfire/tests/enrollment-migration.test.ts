import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { restoreSchema14EnrollmentItems } from './support/schema14.js';
import { restoreSchema16Logging } from './support/schema16.js';

function priorStore() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys=ON'); createSchema(database); restoreSchema14EnrollmentItems(database);
  restoreSchema16Logging(database);
  database.exec(`ALTER TABLE agent ADD COLUMN display_name_override TEXT;
    INSERT INTO principal VALUES('owner','@owner:test','human','active',4,1),('agent','@agent:test','agent','active',7,1);
    INSERT INTO member VALUES('owner','human','Owner');
    INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode) VALUES('agent','agent','owner','selected');
    INSERT INTO agent_credential VALUES('agent','private-password','private-token',1);
    INSERT INTO fleet VALUES(NULL,'fleet',1,'Fleet','Computer',2,1,'owner','fleet',1);
    INSERT INTO fleet_instance VALUES(NULL,'owner','fleet','saved','agent');
    INSERT INTO fleet_credential VALUES('partial','fleet','retained-private-hash',1,NULL);
    INSERT INTO enrollment_request VALUES('Computer','retained-private-hash','partial','owner','fleet','PARTIALCODE1','private-claim','roster','approved',1,1,100,'owner',2);
    INSERT INTO enrollment_request VALUES('Computer','pending-hash','pending','owner','fleet','PENDINGCODE1','pending-claim','pending-roster','pending',0,1,100,NULL,NULL);
    INSERT INTO enrollment_request VALUES('Computer','exact-hash','current','owner','fleet','CURRENTCODE1','exact-claim','exact-roster','pending',0,1,100,NULL,NULL);
    INSERT INTO enrollment_item VALUES('partial','saved','saved','existing','agent',NULL),('partial','collision','collision','failed',NULL,'name_collision'),
      ('pending','claimed','claimed','claimed',NULL,NULL),('pending','capacity','capacity','failed',NULL,'capacity'),('current','exact','exact','claimed',NULL,NULL);
    INSERT INTO agent_name VALUES('saved',NULL,NULL,'agent'),('claimed','pending','claimed',NULL),('exact','current','exact',NULL);
    INSERT INTO enrollment_item_policy VALUES('partial','saved','selected',7),('partial','collision','selected',NULL),
      ('pending','claimed','selected',NULL),('pending','capacity','selected',NULL),('current','exact','selected',NULL);
    INSERT INTO enrollment_item_permission VALUES('partial','saved','room.agent.invite','agent_room'),('pending','claimed','room.agent.invite','agent_room');
    INSERT INTO enrollment_item_wake_sender VALUES('partial','saved','owner',1),('pending','claimed','owner',0);
    INSERT INTO enrollment_controller_metadata VALUES('partial','label','Exact private historical metadata'),('pending','label','Pending metadata');`);
  database.pragma('user_version=14');
  return database;
}

const relations = [['enrollment_request','enrollment_archive','id'], ['enrollment_item','enrollment_archive_item','request_id'],
  ['enrollment_item_policy','enrollment_archive_policy','request_id'], ['enrollment_item_permission','enrollment_archive_permission','request_id'],
  ['enrollment_item_wake_sender','enrollment_archive_wake_sender','request_id'], ['enrollment_controller_metadata','enrollment_archive_metadata','enrollment_id']] as const;

test('schema 14 partial rosters become exact immutable history without a runtime partial-admission path', () => {
  const database = priorStore();
  try {
    const originals = relations.map(([table,,key]) => database.prepare('SELECT * FROM ' + table + ' WHERE ' + key + " IN ('partial','pending') ORDER BY 1,2").all());
    const protectedTables = ['principal','agent_credential','fleet','fleet_instance','fleet_credential'];
    const protectedRows = protectedTables.map(table => database.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all());
    const current = database.prepare("SELECT request_id,instance_key,requested_name,outcome,agent_id FROM enrollment_item WHERE request_id='current'").all();
    createSchema(database);
    for (const [index,[source,target,key]] of relations.entries()) {
      assert.deepEqual(database.prepare('SELECT * FROM ' + target + ' ORDER BY 1,2').all(), originals[index], target);
      assert.deepEqual(database.prepare('SELECT * FROM ' + source + ' WHERE ' + key + " IN ('partial','pending')").all(), [], source);
      assert.throws(() => database.exec('UPDATE ' + target + ' SET ' + key + '=' + key), /immutable/u);
    }
    for (const [index,table] of protectedTables.entries()) assert.deepEqual(database.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all(), protectedRows[index], table);
    assert.deepEqual(database.prepare('SELECT * FROM enrollment_item').all(), current);
    assert.deepEqual(database.prepare('SELECT name FROM agent_name ORDER BY name').all(), [{ name:'exact' },{ name:'saved' }]);
    assert.throws(() => database.exec("INSERT INTO enrollment_item VALUES('current','invalid','invalid','failed',NULL)"), /CHECK/u);
    assert.throws(() => database.exec('SELECT failure_code FROM enrollment_item'), /no such column/u);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('integrity_check', { simple:true }), 'ok');
    assert.equal(database.pragma('foreign_keys', { simple:true }), 1);
    createSchema(database);
    assert.equal(database.prepare<[],{ count:number }>('SELECT count(*) AS count FROM enrollment_archive').get()?.count, 2);
  } finally { database.close(); }
});

test('a partial-roster archival conflict rolls back the complete name and enrollment conversion', () => {
  const database = priorStore();
  try {
    database.exec(`UPDATE agent SET display_name_override='Retired caption';
      INSERT INTO enrollment_archive SELECT controller_name,controller_credential_hash,fleet_key,id,owner_id,verification_code,
        claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at FROM enrollment_request WHERE id='partial'`);
    const before = database.serialize();
    assert.throws(() => createSchema(database), /UNIQUE/u);
    assert.deepEqual(database.serialize(), before);
    assert.equal(database.pragma('user_version', { simple:true }), 14);
    assert.equal(database.pragma('foreign_keys', { simple:true }), 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
