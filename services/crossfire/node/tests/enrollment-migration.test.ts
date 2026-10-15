import { migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { schema14Store as priorStore } from './support/deployed-migration.js';

const relations = [['enrollment_request','enrollment_archive','id'], ['enrollment_item','enrollment_archive_item','request_id'],
  ['enrollment_item_policy','enrollment_archive_policy','request_id'], ['enrollment_item_permission','enrollment_archive_permission','request_id'],
  ['enrollment_item_wake_sender','enrollment_archive_wake_sender','request_id'], ['enrollment_controller_metadata','enrollment_archive_metadata','enrollment_id']] as const;

test('schema 14 partial rosters become exact immutable history without a runtime partial-admission path', async () => {
  const database = priorStore();
  try {
    const originals = relations.map(([table,,key]) => database.prepare('SELECT * FROM ' + table + ' WHERE ' + key + " IN ('partial','pending') ORDER BY 1,2").all());
    const protectedTables = ['principal','agent_credential','fleet','fleet_instance','fleet_credential'];
    const protectedRows = protectedTables.map(table => database.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all());
    const current = database.prepare("SELECT request_id,instance_key,requested_name,outcome,agent_id FROM enrollment_item WHERE request_id='current'").all();
    await migrateFixture(database);
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
    await migrateFixture(database);
    assert.equal(database.prepare<[],{ count:number }>('SELECT count(*) AS count FROM enrollment_archive').get()?.count, 2);
  } finally { database.close(); }
});

test('a partial-roster archival conflict rolls back the complete name and enrollment conversion', async () => {
  const database = priorStore();
  try {
    database.exec(`UPDATE agent SET display_name_override='Retired caption';
      INSERT INTO enrollment_archive SELECT controller_name,controller_credential_hash,fleet_key,id,owner_id,verification_code,
        claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at FROM enrollment_request WHERE id='partial'`);
    const before = database.serialize();
    await assert.rejects(() => migrateFixture(database), /UNIQUE/u);
    assert.deepEqual(database.serialize(), before);
    assert.equal(database.pragma('user_version', { simple:true }), 14);
    assert.equal(database.pragma('foreign_keys', { simple:true }), 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
