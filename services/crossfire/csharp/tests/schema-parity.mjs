import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, rmSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { deployedMigrationFixture } from '../../dist/tests/support/deployed-migration.js';
import { migrationChange, migrationQuery, migrationRows } from '../../dist/tests/support/migration-data.js';

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
  const metadata = migrationRows(database, migrationQuery('sqlite_schema').select('type', 'name', 'tbl_name', 'sql')
    .where('name', 'not like', 'sqlite_%').where('name', 'not like', 'knex_%').orderBy(['type', 'name']));
  const rows = Object.fromEntries(metadata.filter(value => value.type === 'table').map(value => {
    const entries = migrationRows(database, migrationQuery(value.name)).map(row => {
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

function verifiedBackup(native, path) {
  const root = path + '.operator'; mkdirSync(root, { mode: 0o700 });
  const source = join(root, 'management.sqlite'); copyFileSync(path, source); chmodSync(source, 0o600);
  const before = readFileSync(source), binary = native ? resolve(nativeBinary) : dotnetBinary;
  const args = native ? ['--backup', root] : [resolve(managedAssembly), '--backup', root];
  const result = JSON.parse(execFileSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 }).trim());
  assert.equal(result.DynamicCode, !native); assert.equal(result.ReflectionJson, !native);
  assert.equal(typeof result.File, 'string'); assert.equal(resolve(result.File, '..'), join(root, 'backups'));
  assert.deepEqual(readFileSync(source), before, 'Native backup leaves every source page unchanged');
  const original = new Database(source, { readonly: true }), backup = new Database(result.File, { readonly: true });
  try { assert.deepEqual(snapshot(backup), snapshot(original), 'Native backup preserves the exact schema, relationships and every source record'); }
  finally { backup.close(); original.close(); }
}

function fixture(path, version, change) {
  const database = deployedMigrationFixture(version);
  try {
    migrationChange(database, migrationQuery('agent').update({ display_name_override: 'Retired caption' }));
    for (const row of migrationRows(database, migrationQuery('agent').select('principal_id')))
      migrationChange(database, migrationQuery('principal_application').insert({ principal_id: row.principal_id, applied_revision: 9,
        applied_intent_hash: 'retained-intent', applied_status: 'active', native_display_name: 'Retained native name', last_attempt_at: 15,
        last_success_at: 16, next_check_at: 17, error_code: null, error_message: null }));
    if (version === 13) {
      migrationChange(database, migrationQuery('enrollment_request').update({ controller_name: 'Computer "東京"\n' }).where('id', 'request'));
      migrationChange(database, migrationQuery('enrollment_controller_metadata').insert({ enrollment_id: 'request', key: 'a-b', value: 'नमस्ते "review"' }));
      migrationChange(database, migrationQuery('enrollment_controller_metadata').insert({ enrollment_id: 'request', key: 'aa', value: 'Unicode 😀' }));
    }
    change?.(database);
    writeFileSync(path, database.serialize(), { mode: 0o600 });
  } finally { database.close(); }
}

try {
  for (const native of [true, false]) for (const version of [13, 14]) {
    const path = join(directory, `schema-${version}-${native ? 'aot' : 'managed'}.sqlite`);
    fixture(path, version);
    verifiedBackup(native, path);
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
    { version: 13, name: 'replacement-index', change: database => migrationChange(database, migrationQuery.schema.alterTable('principal', table => table.index(['created_at'], 'ix_agent_owner_next'))), message: /already exists/ },
    { version: 13, name: 'incomplete-authority', change: database => migrationChange(database, migrationQuery('enrollment_item_policy').where({ request_id: 'request', instance_key: 'nobody' }).delete()), message: /incomplete wake authority/ },
    { version: 14, name: 'archive-collision', change: database => migrationChange(database, migrationQuery('enrollment_archive').insert(migrationQuery('enrollment_request')
      .select('controller_name', 'controller_credential_hash', 'fleet_key', 'id', 'owner_id', 'verification_code', 'claim_hash', 'roster_digest',
        'status', 'revision', 'created_at', 'expires_at', 'decided_by_member_id', 'decided_at').where('id', 'partial'))), message: /UNIQUE/ },
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
  for (const native of [true, false]) for (const version of [1, 12, 19]) {
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
