import { openTestStore, migrateFixture } from './support/storage.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import type { AuditEvent } from '@ctlflow/crossfire-domain/audit/types';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { applicationFixture, value } from './support/application.js';

function directory(scope: TestContext): string {
  mkdirSync('.temp', { recursive: true });
  const root = mkdtempSync(join(process.cwd(), '.temp/storage-capacity-'));
  cleanup(scope, () => rmSync(root, { recursive: true }));
  return root;
}

function audit(id: string, message: string): AuditEvent {
  return { id, requestId: id, actorCredentialId: null, actorKind: 'system', actorPrincipalId: null,
    ownerId: null, targetKind: 'instance', targetId: 'instance', roomId: null, membershipGeneration: null,
    authorizerId: null, addedById: null, permissionCode: null, action: 'storage.capacity', outcome: 'accepted', message, createdAt: 1 };
}

test('management storage retains native SQLite capacity for memory and every supported page size', async scope => {
  const native = new Database(':memory:'); cleanup(scope, () => native.close());
  const expected = native.pragma('max_page_count', { simple: true });
  const memory = openTestStore(':memory:'); cleanup(scope, () => memory.close());
  assert.equal(memory.pragma('max_page_count', { simple: true }), expected);
  const root = directory(scope);
  for (const pageSize of [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]) {
    const path = join(root, 'pages-' + pageSize + '.sqlite'); writeFileSync(path, '', { mode: 0o600 });
    const initialized = new Database(path);
    try { initialized.pragma('page_size = ' + pageSize); await migrateFixture(initialized); }
    finally { initialized.close(); }
    const database = openTestStore(path);
    try {
      assert.equal(database.pragma('page_size', { simple: true }), pageSize);
      assert.equal(database.pragma('max_page_count', { simple: true }), expected);
      assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
      assert.equal(database.pragma('journal_mode', { simple: true }), 'delete');
    } finally { database.close(); }
  }
});

test('a full 256 MiB management store reopens and registers listeners without losing committed data', async scope => {
  const path = join(directory(scope), 'management.sqlite');
  const original = await applicationFixture(scope, path);
  const agent = await original.agent(original.admin.actor, 'capacity-agent');
  const previousRun = original.listen(agent);
  const principal = value(original.services.repositories.principal.find({ id: agent.id }));
  const policy = value(original.services.repositories.instancePolicy.find({ id: 'instance' }));
  const run = value(original.services.repositories.listenerRun.find({ id: previousRun.runId }));
  original.application.close();
  let database = new Database(path);
  cleanup(scope, () => { if (database.open) database.close(); });
  database.pragma('foreign_keys = ON');
  const pageSize = database.pragma('page_size', { simple: true }); assert.equal(typeof pageSize, 'number');
  const maximum = 256 * 1024 * 1024;
  database.pragma('max_page_count = ' + maximum / Number(pageSize));
  const repositories = createRepositories(database);
  let count = 0, first: AuditEvent | undefined, last: AuditEvent | undefined;
  for (const bytes of [1024 * 1024, 65536, 4096, 256]) {
    const message = 'x'.repeat(bytes);
    let exhausted = false;
    for (let attempt = 0; attempt < 512; attempt++) {
      const record = audit('capacity-' + count, message);
      const inserted = repositories.auditEvent.insert(record);
      if (!inserted.ok) { assert.equal(inserted.error.code, 'unavailable'); exhausted = true; break; }
      first ??= record; last = record; count++;
    }
    assert.equal(exhausted, true, 'The disposable capacity fixture must remain bounded');
  }
  assert.ok(first && last);
  assert.equal(statSync(path).size, maximum);
  assert.equal(database.pragma('freelist_count', { simple: true }), 0);
  database.close();

  const reopened = await applicationFixture(scope, path);
  const registered = reopened.listen(agent);
  const next = value(reopened.services.repositories.listenerRun.find({ id: registered.runId }));
  assert.equal(next?.agentId, agent.id);
  assert.equal(next?.controller?.fleetId, agent.controller.fleetId);
  assert.deepEqual(value(reopened.services.repositories.principal.find({ id: agent.id })), principal);
  assert.deepEqual(value(reopened.services.repositories.instancePolicy.find({ id: 'instance' })), policy);
  assert.deepEqual(value(reopened.services.repositories.listenerRun.find({ id: previousRun.runId })), run);
  for (const record of [first, last]) {
    const retained = value(reopened.services.repositories.auditEvent.find({ id: record.id }));
    assert.equal(retained?.message === record.message, true, 'Committed audit bytes remain identical');
  }
  value(reopened.services.repositories.auditEvent.insert(audit('after-capacity', 'New audit after listener registration')));
  reopened.application.close();
  database = openTestStore(path);
  assert.ok(statSync(path).size > maximum, 'The original database must grow beyond its former ceiling');
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  value(createRepositories(database).auditEvent.insert(audit('after-second-open', 'Growth remains enabled after another reopen')));
});

test('native storage exhaustion is retryable and rolls back the complete transaction', async scope => {
  const database = openTestStore(join(directory(scope), 'management.sqlite')); cleanup(scope, () => database.close());
  const repositories = createRepositories(database), unit = createUnitOfWork(database);
  const principal = { id: 'capacity-owner', matrixUserId: '@capacity-owner:test', kind: 'human' as const,
    status: 'active' as const, revision: 0, createdAt: 1 };
  value(repositories.principal.insert(principal));
  const maximum = database.pragma('max_page_count', { simple: true });
  const pages = database.pragma('page_count', { simple: true });
  database.pragma('max_page_count = ' + pages);
  const record = audit('capacity-retry', 'x'.repeat(128 * 1024));
  function write() {
    return unit.run(() => {
      value(repositories.principal.update({ ...principal, revision: 1 }));
      return repositories.auditEvent.insert(record);
    });
  }
  assert.deepEqual(write(), { ok: false, error: { code: 'unavailable', message: 'Management storage is full; check available disk space before retrying' } });
  assert.equal(database.inTransaction, false);
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
  assert.equal(value(repositories.auditEvent.find({ id: record.id })), null);
  database.pragma('max_page_count = ' + maximum);
  value(write());
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), { ...principal, revision: 1 });
  assert.equal(value(repositories.auditEvent.find({ id: record.id }))?.message === record.message, true, 'The exact retry commits its original bytes');
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

for (const stage of ['start', 'finish']) {
  test('transaction-level capacity failure at ' + stage + ' preserves the original state', async scope => {
    const database = openTestStore(join(directory(scope), 'management.sqlite')); cleanup(scope, () => database.close());
    const repositories = createRepositories(database), unit = createUnitOfWork(database);
    const principal = { id: 'transaction-owner', matrixUserId: '@transaction-owner:test', kind: 'human' as const,
      status: 'active' as const, revision: 0, createdAt: 1 };
    value(repositories.principal.insert(principal));
    const nativeTransaction = database.transaction.bind(database);
    const capacity = Object.assign(new Error('Controlled transaction capacity failure'), { code: 'SQLITE_FULL' });
    const fault = scope.mock.method(database, 'transaction', (operation: () => Result<void>) => {
      if (stage === 'start') throw capacity;
      return nativeTransaction(() => { const result = operation(); if (!result.ok) return result; throw capacity; });
    });
    const record = audit('transaction-retry', 'Retain this exact request');
    function write() {
      return unit.run(() => {
        value(repositories.principal.update({ ...principal, revision: 1 }));
        return repositories.auditEvent.insert(record);
      });
    }
    assert.deepEqual(write(), { ok: false, error: { code: 'unavailable', message: 'Management storage is full; check available disk space before retrying' } });
    fault.mock.restore();
    assert.equal(database.inTransaction, false);
    assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
    assert.equal(value(repositories.auditEvent.find({ id: record.id })), null);
    value(write());
    assert.deepEqual(value(repositories.principal.find({ id: principal.id })), { ...principal, revision: 1 });
    assert.deepEqual(value(repositories.auditEvent.find({ id: record.id })), record);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  });
}
