import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { deployedMigrationFixture } from '../../dist/tests/support/deployed-migration.js';

const [nativeBinary, managedAssembly, dotnetBinary] = process.argv.slice(2);
assert(nativeBinary && managedAssembly && dotnetBinary && process.argv.length === 5, 'Provide native acceptance executable, managed assembly and dotnet executable');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-schema-parity-')); chmodSync(directory, 0o700);
let cases = 0;

function migrate(native, path) {
  const binary = native ? resolve(nativeBinary) : dotnetBinary;
  const args = native ? ['--validate', path] : [resolve(managedAssembly), '--validate', path];
  const value = JSON.parse(execFileSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 }).trim());
  assert.equal(value.DynamicCode, !native); assert.equal(value.ReflectionJson, !native);
  return value;
}

function snapshot(database) {
  const metadata = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%' ORDER BY type,name").all();
  const rows = Object.fromEntries(metadata.filter(value => value.type === 'table').map(value => {
    const entries = database.prepare('SELECT * FROM ' + value.name).all().map(row => {
      if (value.name !== 'audit_event' || row.action !== 'agent.name.canonicalized') return row;
      const { id, created_at, ...stable } = row;
      assert.equal(typeof id, 'string'); assert(created_at > 0);
      return stable;
    });
    return [value.name, entries.map(entry => JSON.stringify(entry)).sort()];
  }));
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  return { metadata, rows, application: database.pragma('application_id', { simple: true }), version: database.pragma('user_version', { simple: true }) };
}

function fixture(path, version, change) {
  const database = deployedMigrationFixture(version);
  try {
    database.exec("UPDATE agent SET display_name_override='Retired caption';");
    database.exec("INSERT INTO principal_application(principal_id,applied_revision,applied_intent_hash,applied_status,native_display_name,last_attempt_at,last_success_at,next_check_at,error_code,error_message) SELECT principal_id,9,'retained-intent','active','Retained native name',15,16,17,NULL,NULL FROM agent;");
    if (version === 13) {
      database.prepare('UPDATE enrollment_request SET controller_name=? WHERE id=?').run('Computer "東京"\n', 'request');
      database.prepare('INSERT INTO enrollment_controller_metadata VALUES(?,?,?)').run('request', 'a-b', 'नमस्ते "review"');
      database.prepare('INSERT INTO enrollment_controller_metadata VALUES(?,?,?)').run('request', 'aa', 'Unicode 😀');
    }
    change?.(database);
    writeFileSync(path, database.serialize(), { mode: 0o600 });
  } finally { database.close(); }
}

try {
  for (const native of [true, false]) for (const version of [13, 14]) {
    const path = join(directory, `schema-${version}-${native ? 'aot' : 'managed'}.sqlite`);
    fixture(path, version);
    const expectedPath = path + '.node-reference'; copyFileSync(path, expectedPath); chmodSync(expectedPath, 0o600);
    await migrateDatabase(expectedPath);
    const expected = openStore(expectedPath);
    let canonical;
    try { canonical = snapshot(expected); } finally { expected.close(); }
    assert.equal(migrate(native, path).Status, 'rejected', 'Applications never migrate deployed schemas');
    await migrateDatabase(path);
    assert.equal(migrate(native, path).Status, 'passed', 'Knex migration allows application startup');
    const migrated = new Database(path);
    try { assert.deepEqual(snapshot(migrated), canonical, `schema ${version} preserves exact Node migration representations`); }
    finally { migrated.close(); }
    await migrateDatabase(path);
    assert.equal(migrate(native, path).Status, 'passed', 'Knex migration is repeatable without extra archive/audit records');
    const repeated = new Database(path);
    try { assert.deepEqual(snapshot(repeated), canonical); } finally { repeated.close(); }
    cases++;
  }
  const failures = [
    { version: 13, name: 'replacement-index', change: database => database.exec('CREATE INDEX ix_agent_owner_next ON principal(created_at)'), message: /already exists/ },
    { version: 13, name: 'incomplete-authority', change: database => database.exec("DELETE FROM enrollment_item_policy WHERE request_id='request' AND instance_key='nobody'"), message: /incomplete wake authority/ },
    { version: 14, name: 'archive-collision', change: database => database.exec("INSERT INTO enrollment_archive SELECT controller_name,controller_credential_hash,fleet_key,id,owner_id,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at FROM enrollment_request WHERE id='partial'"), message: /UNIQUE/ },
  ];
  for (const native of [true, false]) for (const failure of failures) {
    const path = join(directory, `${failure.name}-${native ? 'aot' : 'managed'}.sqlite`);
    fixture(path, failure.version, failure.change);
    const original = new Database(path); let before;
    try { before = snapshot(original); } finally { original.close(); }
    await assert.rejects(() => migrateDatabase(path), failure.message);
    assert.equal(migrate(native, path).Status, 'rejected', 'Failed migration blocks application startup');
    const after = new Database(path);
    try { assert.deepEqual(snapshot(after), before, 'Rejected conversion preserves every row, schema definition, guard and version'); }
    finally { after.close(); }
    cases++;
  }
  for (const native of [true, false]) for (const version of [1, 12, 18]) {
    const path = join(directory, `unsupported-${version}-${native ? 'aot' : 'managed'}.sqlite`);
    fixture(path, 13, database => database.pragma('user_version=' + version));
    const original = new Database(path); let before;
    try { before = snapshot(original); } finally { original.close(); }
    await assert.rejects(() => migrateDatabase(path), /Unsupported Crossfire schema/);
    const rejected = migrate(native, path); assert.equal(rejected.Status, 'rejected'); assert.match(rejected.Error, /Unsupported Crossfire schema/);
    const after = new Database(path);
    try { assert.deepEqual(snapshot(after), before); } finally { after.close(); }
    cases++;
  }
  console.log(JSON.stringify({ scope: 'schema 13/14 data, canonical digests, rollback and unsupported-version preservation', status: 'passed', cases }));
} finally { rmSync(directory, { recursive: true }); }
