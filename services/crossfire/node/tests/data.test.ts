import { openTestStore } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { decodeUtf8 } from '@ctlflow/crossfire-kernel/bytes';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { value } from './support/application.js';

function directory() { mkdirSync('.temp', { recursive: true }); return mkdtempSync(join(process.cwd(), '.temp/storage-')); }
test('private normalized state survives reopen and transaction failures preserve exact data', () => {
  const path = join(directory(), 'private/management.sqlite');
  let database = openTestStore(path), repositories = createRepositories(database);
  const principal = { id: 'owner', matrixUserId: '@owner:test', kind: 'human' as const, status: 'active' as const, revision: 0, createdAt: 1 };
  value(repositories.principal.insert(principal));
  const unit = createUnitOfWork(database);
  assert.equal(unit.run(() => { value(repositories.principal.update({ ...principal, status: 'suspended' })); return failure('conflict', 'rollback'); }).ok, false);
  assert.throws(() => unit.run(() => { value(repositories.principal.update({ ...principal, status: 'revoked' })); throw Error('rollback'); }), /rollback/);
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
  assert.equal(repositories.member.insert({ principalId: 'missing', principalKind: 'human', displayName: 'Missing' }).ok, false);
  assert.equal(database.pragma('journal_mode', { simple: true }), 'delete');
  const policy = { id: 'instance' as const, revision: 0, fleetIdleTimeoutSeconds: 1800, maxMessageBytes: 65536, maxOwnerAgents: 7, maxAgents: 50, maxPending: 35, enrollmentSeconds: 120, reconcileSeconds: 300, agentInstructions: 'Use project tickets. 東京', signupMode: 'invitation' as const, invitationIssuers: 'administrators' as const };
  value(repositories.instancePolicy.insert(policy)); database.close();
  database = openTestStore(path); repositories = createRepositories(database);
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
  assert.deepEqual(value(repositories.instancePolicy.find({ id: 'instance' })), policy);
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(database.pragma('foreign_key_check'), []);
  assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
  database.close();
});
test('storage refuses symlinks and public files without modifying their permissions', () => {
  const root = directory(), file = join(root, 'public.sqlite'); writeFileSync(file, 'unrelated', { mode: 0o644 });
  assert.throws(() => openTestStore(file), /private/); assert.equal(statSync(file).mode & 0o777, 0o644);
  chmodSync(file, 0o600); const link = join(root, 'linked.sqlite'); symlinkSync(file, link);
  assert.throws(() => openTestStore(link), /ELOOP|regular/);
});
test('UTF-8 decoding rejects malformed bytes without replacing or repairing private state', () => {
  const root = directory(), path = join(root, 'state.json');
  const malformed = [[0x80], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]];
  try {
    assert.equal(decodeUtf8(Buffer.from('東京 \ufffd')), '東京 \ufffd');
    assert.equal(decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), '\ufeffa');
    for (const bytes of malformed) {
      assert.throws(() => decodeUtf8(Uint8Array.from(bytes)), TypeError);
      const content = Buffer.concat([Buffer.from('{"value":"'), Buffer.from(bytes), Buffer.from('"}')]);
      writeFileSync(path, content, { mode: 0o600 });
      assert.throws(() => readJson(path), /encoding|UTF|utf/u);
      assert.throws(() => writeJson(path, { value: 'replacement' }), /encoding|UTF|utf/u);
      assert.equal(readFileSync(path).equals(content), true);
    }
    for (const text of ['{"value":"\\ud800"}', '{"\\udfff":true}']) {
      const content = Buffer.from(text); writeFileSync(path, content, { mode: 0o600 });
      assert.throws(() => readJson(path), /Unicode JSON/u);
      assert.throws(() => writeJson(path, { value: 'replacement' }), /Unicode JSON/u);
      assert.equal(readFileSync(path).equals(content), true);
    }
    rmSync(path);
    assert.throws(() => writeJson(path, { value: '\ud800' }), /Unicode JSON/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
