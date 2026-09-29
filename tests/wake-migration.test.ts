import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openStore, type Store } from '../apps/server/src/data/database.js';
import { context, secret } from '../apps/server/src/context.js';
import * as queries from '../apps/server/src/data/queries.js';
import { WAKE_POLICIES } from '../packages/contracts/src/wake.js';

function snapshot(store: Store) {
  return Object.fromEntries(['members', 'agents', 'enrollments', 'listeners', 'policy', 'audit'].map(table =>
    [table, store.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()]));
}

function fixture() {
  mkdirSync('.temp', { recursive: true });
  const path = join(mkdtempSync('.temp/wake-migration-'), 'management.sqlite');
  const store = openStore(path);
  const owner = '@owner:tests.localhost';
  const ctx = context(store, { instance: 'tests', serverName: 'tests.localhost', publicOrigin: 'http://127.0.0.1',
    matrixOrigin: 'http://127.0.0.1', administrator: owner, registrationSecret: secret(), jwtSecret: secret() });
  ctx.native.close();
  for (const wakePolicy of ['owner', 'owner-agents', 'humans', 'everyone'] as const) {
    const id = randomUUID();
    queries.insertAgent(store, { id, owner, userId: '@agent-' + id + ':tests.localhost', name: wakePolicy,
      override: 'Configured name', wakePolicy, status: 'active', revision: 3, grantRevision: 2,
      grants: '[{"room":"!native","access":"reply","muted":false}]', applied: '[]', password: secret(), token: secret(),
      appliedRevision: 2, appliedGrantRevision: 1, lastSuccess: 10, error: 'Pending fixture grant', created: 1 });
    queries.insertEnrollment(store, { id: randomUUID(), owner, name: wakePolicy, code: secret(), secretHash: secret(),
      status: 'approved', expires: 100, agent: id });
    store.prepare('INSERT INTO listeners VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), id, 'fixture-release', 1, 10, 9, 5, 0, 0);
  }
  const definition = store.prepare<[], { sql: string }>("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'agents'").get()!.sql;
  assert(definition.includes("'nobody',"));
  store.pragma('foreign_keys = OFF');
  store.transaction(() => {
    store.exec(definition.replace('CREATE TABLE agents', 'CREATE TABLE agents_previous').replace("'nobody',", ''));
    store.exec('INSERT INTO agents_previous SELECT * FROM agents; DROP TABLE agents; ALTER TABLE agents_previous RENAME TO agents; CREATE INDEX agents_owner ON agents(owner)');
    store.pragma('user_version = 0');
  }).immediate();
  store.pragma('foreign_keys = ON');
  assert.throws(() => store.prepare("UPDATE agents SET wakePolicy = 'nobody'").run(), /CHECK/);
  return { store, path, owner };
}

test('populated wake-policy migration preserves values and references, admits nobody and retains strict constraints', () => {
  const original = fixture();
  const expected = snapshot(original.store);
  original.store.close();
  let store = openStore(original.path);
  try {
    assert.deepEqual(snapshot(store), expected);
    assert.equal(store.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(store.pragma('user_version', { simple: true }), 1);
    assert.deepEqual(store.pragma('foreign_key_check'), []);
    assert.equal(store.pragma('integrity_check', { simple: true }), 'ok');
    assert(store.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'agents_owner'").get());
    assert.throws(() => store.prepare("UPDATE agents SET wakePolicy = 'all'").run(), /CHECK/);
    assert.throws(() => store.prepare("UPDATE agents SET owner = '@missing:tests.localhost'").run(), /FOREIGN KEY/);
    const agent = queries.agents(store, original.owner, false)[0]!;
    for (const wakePolicy of WAKE_POLICIES) {
      const current = queries.agent(store, agent.id)!;
      assert.equal(queries.changeAgent(store, current.id, current.revision, current.status, current.override, current.grants, current.grantRevision, wakePolicy), 1);
    }
    const current = queries.agent(store, agent.id)!;
    assert.equal(queries.changeAgent(store, current.id, current.revision, current.status, current.override, current.grants, current.grantRevision, 'nobody'), 1);
    const updated = snapshot(store);
    store.close(); store = openStore(original.path);
    assert.deepEqual(snapshot(store), updated);
    assert.equal(queries.agent(store, agent.id)!.wakePolicy, 'nobody');
    assert.deepEqual(store.pragma('foreign_key_check'), []);
  } finally { store.close(); }
});

test('migration failure rolls back the schema and data rather than accepting broken references', () => {
  const { store, path } = fixture();
  store.pragma('foreign_keys = OFF');
  store.prepare("UPDATE agents SET owner = '@missing:tests.localhost'").run();
  const before = snapshot(store);
  store.close();
  assert.throws(() => openStore(path), /invalid foreign keys/);
  const inspect = new Database(path);
  try {
    assert.deepEqual(snapshot(inspect), before);
    assert.equal(inspect.pragma('user_version', { simple: true }), 0);
    assert.throws(() => inspect.prepare("UPDATE agents SET wakePolicy = 'nobody'").run(), /CHECK/);
    assert.equal(inspect.prepare("SELECT name FROM sqlite_schema WHERE name = 'agents_migration'").get(), undefined);
  } finally { inspect.close(); }
});
