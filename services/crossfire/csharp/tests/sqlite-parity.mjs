import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import definition from '@ctlflow/crossfire-data/management/sqlite/schema' with { type: 'json' };
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';

const [nativeBinary, managedAssembly, dotnetBinary] = process.argv.slice(2);
assert(nativeBinary && managedAssembly && dotnetBinary && process.argv.length === 5, 'Provide native acceptance executable, managed assembly and dotnet executable');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-sqlite-parity-')); chmodSync(directory, 0o700);

function checkDatabase(database) {
  const rows = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%' ORDER BY type,name").all();
  assert.equal(rows.filter(row => row.type === 'table').length, 63);
  assert.equal(rows.filter(row => row.type === 'index').length, 93);
  assert.equal(rows.filter(row => row.type === 'trigger').length, 26);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  assert.equal(database.pragma('application_id', { simple: true }), 1129465426);
  assert.equal(database.pragma('user_version', { simple: true }), 17);
  assert.deepEqual(database.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
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
    let database = openStore(path);
    let schema;
    try {
      schema = checkDatabase(database);
      const repository = createRepositories(database), directoryReader = createDirectoryRepository(database);
      const record = directoryReader.member(first.OwnerId);
      assert(record.ok && record.value, 'Node must read native EF writes');
      assert.equal(record.value.principal.matrixUserId, first.MatrixId);
      assert.equal(record.value.member.displayName, 'Native renamed owner');
      assert.equal(record.value.principal.revision, 1);
      assert.equal(repository.member.update({ ...record.value.member, displayName: 'Node wrote this member' }).ok, true);
      const secret = randomBytes(32).toString('base64url');
      assert.equal(repository.memberSession.insert({ secretHash: createHash('sha256').update(secret).digest('hex'),
        memberId: first.OwnerId, csrfSecret: randomBytes(32).toString('base64url'), nativeAccessToken: 'node-native-token', createdAt: 1700000000000, expiresAt: 1700000000001 }).ok, true);
    } finally { database.close(); }
    const second = run(!firstNative, path);
    database = openStore(path);
    try {
      assert.deepEqual(checkDatabase(database), schema, 'Opening another implementation must not mutate schema');
      const directoryReader = createDirectoryRepository(database);
      assert.equal(directoryReader.member(first.OwnerId).value.member.displayName, 'Node wrote this member');
      assert.equal(directoryReader.member(second.OwnerId).value.principal.matrixUserId, second.MatrixId);
    } finally { database.close(); }
  }
  const path = join(directory, 'knex-created.sqlite'); await migrateDatabase(path); const database = openStore(path);
  try { checkDatabase(database); } finally { database.close(); }
  run(true, path); run(false, path);
  for (const native of [true, false]) for (const version of [15, 16]) {
    const path = join(directory, 'schema-' + version + '-' + (native ? 'aot' : 'managed') + '.sqlite');
    await migrateDatabase(path);
    const database = openStore(path);
    let canonical;
    try {
      canonical = checkDatabase(database);
      for (const index of definition.parts.loggingSchema.matchAll(/CREATE INDEX (\w+)/gu)) database.exec('DROP INDEX ' + index[1]);
      for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy', 'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
        database.exec('CREATE TRIGGER protect_' + table + '_delete BEFORE DELETE ON ' + table + " BEGIN SELECT RAISE(ABORT, 'Archived enrollment history is immutable'); END;");
      database.exec('DELETE FROM knex_migrations');
      database.pragma('user_version=' + version);
    } finally { database.close(); }
    const expectedPath = path + '.node-reference'; copyFileSync(path, expectedPath); chmodSync(expectedPath, 0o600);
    await migrateDatabase(expectedPath);
    const expected = openStore(expectedPath);
    try { canonical = checkDatabase(expected); } finally { expected.close(); }
    await migrateDatabase(path);
    run(native, path);
    const migrated = openStore(path);
    try { assert.deepEqual(checkDatabase(migrated), canonical, 'Forward schema conversion preserves the canonical database shape'); }
    finally { migrated.close(); }
  }
  console.log(JSON.stringify({ status: 'passed', directions: ['Node→managed', 'Node→AOT', 'managed→Node', 'AOT→Node', 'managed→AOT', 'AOT→managed'] }));
} finally { rmSync(directory, { recursive: true }); }
