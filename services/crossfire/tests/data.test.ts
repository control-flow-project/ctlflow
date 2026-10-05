import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { createUnitOfWork } from '@crossfire/adapter-sqlite/unit-of-work';
import { failure } from '@crossfire/kernel/result';
import { value } from './support/application.js';

function directory() { mkdirSync('.temp', { recursive: true }); return mkdtempSync(join(process.cwd(), '.temp/storage-')); }
test('private normalized state survives reopen and transaction failures preserve exact data', () => {
  const path = join(directory(), 'private/management.sqlite');
  let database = openStore(path), repositories = createRepositories(database);
  const principal = { id: 'owner', matrixUserId: '@owner:test', kind: 'human' as const, status: 'active' as const, revision: 0, createdAt: 1 };
  value(repositories.principal.insert(principal));
  const unit = createUnitOfWork(database);
  assert.equal(unit.run(() => { value(repositories.principal.update({ ...principal, status: 'suspended' })); return failure('conflict', 'rollback'); }).ok, false);
  assert.throws(() => unit.run(() => { value(repositories.principal.update({ ...principal, status: 'revoked' })); throw Error('rollback'); }), /rollback/);
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
  assert.equal(repositories.member.insert({ principalId: 'missing', principalKind: 'human', displayName: 'Missing' }).ok, false);
  assert.equal(database.pragma('journal_mode', { simple: true }), 'delete');
  const pageSize = database.pragma('page_size', { simple: true }), maxPages = database.pragma('max_page_count', { simple: true });
  assert(typeof pageSize === 'number' && typeof maxPages === 'number' && pageSize * maxPages <= 256 * 1024 * 1024);
  const policy = { id: 'instance' as const, revision: 0, fleetIdleTimeoutSeconds: 1800, maxMessageBytes: 65536, maxOwnerAgents: 7, maxAgents: 50, maxPending: 35, enrollmentSeconds: 120, reconcileSeconds: 300, agentInstructions: 'Use project tickets. 東京', signupMode: 'invitation' as const, invitationIssuers: 'administrators' as const };
  value(repositories.instancePolicy.insert(policy)); database.close();
  database = openStore(path); repositories = createRepositories(database);
  assert.deepEqual(value(repositories.principal.find({ id: principal.id })), principal);
  assert.deepEqual(value(repositories.instancePolicy.find({ id: 'instance' })), policy);
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(database.pragma('foreign_key_check'), []);
  assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
  database.close();
});
test('storage refuses symlinks and public files without modifying their permissions', () => {
  const root = directory(), file = join(root, 'public.sqlite'); writeFileSync(file, 'unrelated', { mode: 0o644 });
  assert.throws(() => openStore(file), /private/); assert.equal(statSync(file).mode & 0o777, 0o644);
  chmodSync(file, 0o600); const link = join(root, 'linked.sqlite'); symlinkSync(file, link);
  assert.throws(() => openStore(link), /ELOOP|regular/);
});
