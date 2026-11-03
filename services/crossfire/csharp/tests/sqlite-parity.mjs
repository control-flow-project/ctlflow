import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { databaseIdentity, foreignKeyViolations, integrityResults } from '@ctlflow/crossfire-database-inspection/schema/metadata';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { migrationQuery, migrationRows, migrationChange } from '../../dist/tests/support/migration-data.js';

const [nativeBinary, managedAssembly, dotnetBinary] = process.argv.slice(2);
assert(nativeBinary && managedAssembly && dotnetBinary && process.argv.length === 5, 'Provide native acceptance executable, managed assembly and dotnet executable');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-sqlite-parity-')); chmodSync(directory, 0o700);

function checkDatabase(database) {
  const rows = migrationRows(database, migrationQuery('sqlite_schema').select('type', 'name', 'tbl_name', 'sql')
    .where('name', 'not like', 'sqlite_%').where('name', 'not like', 'knex_%').orderBy(['type', 'name']));
  assert.equal(rows.filter(row => row.type === 'table').length, 57);
  assert.equal(rows.filter(row => row.type === 'index').length, 87);
  assert.equal(rows.filter(row => row.type === 'trigger').length, 20);
  assert.deepEqual(foreignKeyViolations(database), []);
  assert.deepEqual(databaseIdentity(database), { application: 1129465426, version: 1 });
  assert.deepEqual(integrityResults(database), [{ integrity_check: 'ok' }]);
  return rows;
}

function run(native, path) {
  const binary = native ? resolve(nativeBinary) : dotnetBinary;
  const args = native ? [path] : [resolve(managedAssembly), path];
  const result = JSON.parse(execFileSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 }).trim());
  assert.equal(result.Status, 'passed'); assert.equal(result.DynamicCode, !native); assert.equal(result.ReflectionJson, !native);
  return result;
}

try {
  assert.equal(readFileSync(nativeBinary).subarray(0, 4).toString('hex'), '7f454c46', 'Native acceptance must be an ELF executable');
  for (const firstNative of [true, false]) {
    const path = join(directory, firstNative ? 'native-created.sqlite' : 'managed-created.sqlite');
    await migrateDatabase(path);
    const first = run(firstNative, path);
    let database = new Database(path, { fileMustExist: true });
    let schema;
    try {
      schema = checkDatabase(database);
      const [record] = migrationRows(database, migrationQuery('principal').join('member', 'principal.id', 'member.principal_id').where('principal.id', first.OwnerId));
      assert(record, 'Fixture queries must read native EF writes');
      assert.equal(record.backend_user_id, first.BackendUserId);
      assert.equal(record.display_name, 'Native renamed owner');
      assert.equal(record.revision, 1);
      migrationChange(database, migrationQuery('member').where('principal_id', first.OwnerId).update({ display_name: 'Fixture wrote this member' }));
      const secret = randomBytes(32).toString('base64url');
      migrationChange(database, migrationQuery('member_session').insert({ secret_hash: createHash('sha256').update(secret).digest('hex'),
        member_id: first.OwnerId, csrf_secret: randomBytes(32).toString('base64url'), native_access_token: 'fixture-native-token', created_at: 1700000000000, expires_at: 1700000000001 }));
    } finally { database.close(); }
    const second = run(!firstNative, path);
    database = new Database(path, { fileMustExist: true });
    try {
      assert.deepEqual(checkDatabase(database), schema, 'Opening another implementation must not mutate schema');
      assert.equal(migrationRows(database, migrationQuery('member').where('principal_id', first.OwnerId))[0].display_name, 'Fixture wrote this member');
      assert.equal(migrationRows(database, migrationQuery('principal').where('id', second.OwnerId))[0].backend_user_id, second.BackendUserId);
    } finally { database.close(); }
  }
  const path = join(directory, 'knex-created.sqlite'); await migrateDatabase(path); const database = new Database(path, { fileMustExist: true });
  try { checkDatabase(database); } finally { database.close(); }
  run(true, path); run(false, path);
  console.log(JSON.stringify({ status: 'passed', directions: ['fixture→managed', 'fixture→AOT', 'managed→fixture', 'AOT→fixture', 'managed→AOT', 'AOT→managed'] }));
} finally { rmSync(directory, { recursive: true }); }
