import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { databaseIdentity, foreignKeyViolations, integrityResult } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { migrationChange, migrationQuery, migrationSnapshot } from '../../dist/tests/support/migration-data.js';
import contract from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };

const [nativeBinary, managedAssembly, dotnetBinary] = process.argv.slice(2);
assert(nativeBinary && managedAssembly && dotnetBinary && process.argv.length === 5, 'Provide native acceptance executable, managed assembly and dotnet executable');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-schema-parity-')); chmodSync(directory, 0o700);
function invoke(native, ...arguments_) {
  const binary = native ? resolve(nativeBinary) : dotnetBinary;
  const args = native ? arguments_ : [resolve(managedAssembly), ...arguments_];
  const result = JSON.parse(execFileSync(binary, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 }).trim());
  assert.equal(result.DynamicCode, !native); assert.equal(result.ReflectionJson, !native);
  return result;
}
function snapshot(path) {
  const database = new Database(path, { readonly: true });
  try {
    assert.deepEqual(databaseIdentity(database), { application: contract.application, version: contract.version });
    assert.equal(integrityResult(database), 'ok'); assert.deepEqual(foreignKeyViolations(database), []);
    return migrationSnapshot(database);
  } finally { database.close(); }
}
try {
  for (const native of [true, false]) {
    const root = join(directory, native ? 'aot' : 'managed'); mkdirSync(root, { mode: 0o700 });
    const path = join(root, 'management.sqlite'); await migrateDatabase(path);
    const database = new Database(path);
    try {
      database.pragma('foreign_keys=ON');
      migrationChange(database, migrationQuery('principal').insert({ id: 'opaque/person', backend_user_id: 'person/東京', kind: 'human', status: 'active', revision: 3, created_at: 1 }));
      assert.throws(() => migrationChange(database, migrationQuery('principal').insert({ id: 'duplicate', backend_user_id: 'person/東京', kind: 'human', status: 'active', revision: 0, created_at: 1 })), /UNIQUE/u);
      assert.throws(() => migrationChange(database, migrationQuery('member').insert({ principal_id: 'missing', principal_kind: 'human', display_name: 'Missing' })), /FOREIGN KEY/u);
      assert.throws(() => migrationChange(database, migrationQuery('principal').where('id', 'opaque/person').update({ revision: -1 })), /CHECK/u);
    } finally { database.close(); }
    const before = snapshot(path), bytes = readFileSync(path);
    assert.equal(invoke(native, '--validate', path).Status, 'passed');
    assert.deepEqual(readFileSync(path), bytes, 'Runtime validation does not alter schema or source records');
    const backup = invoke(native, '--backup', root);
    assert.equal(typeof backup.File, 'string'); assert.equal(resolve(backup.File, '..'), join(root, 'backups'));
    assert.deepEqual(snapshot(backup.File), before, 'Backup contains every current record and relationship');
    await migrateDatabase(path);
    assert.deepEqual(snapshot(path), before, 'Repeated Knex initialization does not rewrite current data');
    assert.equal(invoke(!native, '--validate', path).Status, 'passed');
    assert.deepEqual(snapshot(path), before, 'The other implementation consumes the exact same schema');
  }
  console.log(JSON.stringify({ scope: 'current schema, native validation, constraints and backups', status: 'passed', implementations: ['managed', 'NativeAOT'] }));
} finally { rmSync(directory, { recursive: true }); }
