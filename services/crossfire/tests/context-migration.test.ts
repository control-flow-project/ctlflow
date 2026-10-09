import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { migrateCodexContexts } from '@ctlflow/crossfire-adapter-codex/context-migration';
import { CONTEXT_MIGRATION, CONTEXT_REGISTRY, contextReceipt, contextState, migrationFiles, obsoleteContextFile } from '@ctlflow/crossfire-adapter-codex/context-state';
import { value } from '@ctlflow/crossfire-test-support/result';

function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'native-context-migration-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, '.codex'); mkdirSync(home, { mode: 0o700 });
  const shared = randomUUID(), control = randomUUID(), room = randomUUID();
  const registry = { mode: 'per-room' as const, bindings: [{ context: 'shared', sessionId: shared },
    { context: 'control', sessionId: control }, { context: '!alpha:test', sessionId: room }] };
  writeJson(join(home, 'crossfire-session.json'), { sessionId: shared });
  writeJson(join(home, 'crossfire-contexts.json'), { mode: registry.mode, control, rooms: [{ room: '!alpha:test', sessionId: room }] });
  writeJson(join(home, 'crossfire-session.json.receipt'), { sessionId: shared, pending: null,
    confirmed: [{ messageId: 'received', digest: 'a'.repeat(64) }] });
  for (const name of ['crossfire-session.json.receipt', 'crossfire-session.json.receipt.instructions',
    'crossfire-contexts.json.' + createHash('sha256').update('control').digest('hex') + '.receipt',
    'crossfire-contexts.json.' + createHash('sha256').update('!alpha:test').digest('hex') + '.receipt']) acquireFileLock(join(home, name))();
  writeFileSync(join(home, 'auth.json'), '{"private":"unchanged"}', { mode: 0o600 });
  mkdirSync(join(home, 'sessions'), { mode: 0o700 }); writeFileSync(join(home, 'sessions', 'native.jsonl'), 'native conversation bytes', { mode: 0o600 });
  return { home, registry, input: { workspace: directory, stateDirectory: directory } };
}

test('explicit context conversion preserves exact histories, receipt bytes and login without any runtime fallback', async scope => {
  const { home, registry, input } = fixture(scope), old = readFileSync(join(home, 'crossfire-session.json.receipt'));
  assert.throws(() => contextState(home), /explicit fleetd --migrate-contexts/u);
  const result = value(await migrateCodexContexts(input)); assert.deepEqual(result, { migrated: true, contexts: 3 });
  assert.deepEqual(contextState(home).state, registry);
  assert.deepEqual(readFileSync(contextReceipt(home, 'shared')), old);
  assert.deepEqual(readFileSync(join(home, 'crossfire-migrations/context-registry/originals/crossfire-session.json.receipt')), old);
  assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), '{"private":"unchanged"}');
  assert.equal(readFileSync(join(home, 'sessions/native.jsonl'), 'utf8'), 'native conversation bytes');
  assert(readdirSync(home).every(name => !name.startsWith('crossfire-session.json') && !name.startsWith('crossfire-contexts.json')));
  assert.deepEqual(value(await migrateCodexContexts(input)), { migrated: false, contexts: 3 });
});

test('interrupted explicit conversion resumes from verified archives and refuses contradictory state', async scope => {
  const { home, registry, input } = fixture(scope);
  const expected = migrationFiles(registry);
  const files = readdirSync(home).filter(obsoleteContextFile).map(name => ({ name,
    digest: createHash('sha256').update(readFileSync(join(home, name))).digest('hex'),
    target: expected.get(name)!.target }));
  writeJson(join(home, CONTEXT_MIGRATION), { phase: 'prepared', registry, files });
  const archive = join(home, 'crossfire-migrations/context-registry/originals'); mkdirSync(archive, { mode: 0o700 });
  writeFileSync(join(archive, files[0]!.name), readFileSync(join(home, files[0]!.name)), { mode: 0o600 }); unlinkSync(join(home, files[0]!.name));
  writeJson(join(home, CONTEXT_REGISTRY), registry);
  assert.throws(() => contextState(home), /migration|explicit/u);
  writeFileSync(contextReceipt(home, 'shared'), '{}', { mode: 0o600 });
  const refused = await migrateCodexContexts(input); assert.equal(refused.ok, false);
  assert.equal(readFileSync(join(home, 'crossfire-session.json.receipt'), 'utf8').includes('received'), true);
  unlinkSync(contextReceipt(home, 'shared'));
  assert.equal(value(await migrateCodexContexts(input)).migrated, true);
  assert.deepEqual(contextState(home).state, registry);
});

test('an interrupted manifest cannot omit retained metadata or partially publish a registry', async scope => {
  const { home, registry, input } = fixture(scope), expected = migrationFiles(registry);
  const files = readdirSync(home).filter(obsoleteContextFile).filter(name => name !== 'crossfire-session.json.receipt.instructions.lock').map(name => ({ name,
    digest: createHash('sha256').update(readFileSync(join(home, name))).digest('hex'), target: expected.get(name)!.target }));
  const receipt = readFileSync(join(home, 'crossfire-session.json.receipt'));
  writeJson(join(home, CONTEXT_MIGRATION), { phase: 'prepared', registry, files });
  const refused = await migrateCodexContexts(input);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error.message, /manifest omits retained native metadata/u);
  assert.deepEqual(readFileSync(join(home, 'crossfire-session.json.receipt')), receipt);
  assert.equal(readdirSync(home).includes(CONTEXT_REGISTRY), false);
});

test('active receipt ownership and corrupt or unsafe metadata prevent conversion without deleting original state', async scope => {
  const { home, input } = fixture(scope), receipt = join(home, 'crossfire-session.json.receipt');
  const bytes = readFileSync(receipt), unlock = acquireFileLock(receipt);
  try { assert.equal((await migrateCodexContexts(input)).ok, false); assert.deepEqual(readFileSync(receipt), bytes); }
  finally { unlock(); }
  unlinkSync(receipt); symlinkSync(join(home, 'auth.json'), receipt);
  assert.equal((await migrateCodexContexts(input)).ok, false);
  assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), '{"private":"unchanged"}');
  unlinkSync(receipt); writeJson(receipt, { sessionId: randomUUID(), pending: null, confirmed: [] });
  assert.equal((await migrateCodexContexts(input)).ok, false);
  assert.equal(readdirSync(home).includes('crossfire-session.json'), true);
});

test('a corrupt migration plan cannot retire credentials or redirect receipts', async scope => {
  const { home, registry, input } = fixture(scope), authentication = readFileSync(join(home, 'auth.json'));
  for (const file of [
    { name: 'auth.json', target: null },
    { name: 'crossfire-session.json.receipt', target: 'auth.json' },
    { name: '../auth.json', target: null },
  ]) {
    writeJson(join(home, CONTEXT_MIGRATION), { phase: 'prepared', registry,
      files: [{ ...file, digest: createHash('sha256').update(authentication).digest('hex') }] });
    const refused = await migrateCodexContexts(input);
    assert.equal(refused.ok, false);
    assert.deepEqual(readFileSync(join(home, 'auth.json')), authentication);
    assert.equal(readdirSync(home).includes('crossfire-session.json'), true);
  }
});
