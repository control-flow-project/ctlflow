import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import { databaseIdentity, databaseValid } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { openTestStore } from './support/storage.js';
import { value } from './support/application.js';

test('a management reader does not block a committed heartbeat or omit committed WAL from a backup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-storage-concurrency-'));
  const path = join(root, 'private/management.sqlite');
  const writer = openTestStore(path);
  const reader = new Database(path, { readonly: true, fileMustExist: true });
  const repositories = createRepositories(writer), reads = createRepositories(reader);
  const original = { id: 'concurrent-owner', matrixUserId: '@concurrent:example.test', kind: 'human' as const, status: 'active' as const, revision: 0, createdAt: 1 };
  try {
    assert.deepEqual(databaseIdentity(writer), { application: 1129465426, version: SCHEMA_VERSION });
    assert.equal(databaseValid(writer), true);
    value(repositories.principal.insert(original));
    reader.transaction(() => {
      assert.equal(value(reads.principal.find({ id: original.id }))?.revision, 0);
      const committed = createUnitOfWork(writer).run(() => repositories.principal.update({ ...original, revision: 1 }));
      assert.equal(committed.ok, true, 'An existing read snapshot must not prevent a heartbeat transaction from committing');
      assert.equal(value(reads.principal.find({ id: original.id }))?.revision, 0, 'The reader retains its original snapshot');
    }).deferred();
    const backup = join(root, 'backup.sqlite');
    await writer.backup(backup);
    const restored = new Database(backup, { readonly: true, fileMustExist: true });
    try {
      assert.equal(value(createRepositories(restored).principal.find({ id: original.id }))?.revision, 1);
      assert.equal(databaseValid(restored), true);
    } finally { restored.close(); }
    assert.equal(value(reads.principal.find({ id: original.id }))?.revision, 1);
    assert.equal(writer.pragma('synchronous', { simple: true }), 2, 'Concurrency does not weaken full commit durability');
  } finally {
    reader.close(); writer.close(); rmSync(root, { recursive: true });
  }
});
