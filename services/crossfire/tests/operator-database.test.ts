import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, copyFileSync, readFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@crossfire/adapter-sqlite/schema/tables';
import { cleanup } from '@crossfire/test-support/cleanup';
import { applicationFixture, value } from './support/application.js';
import { inspectDatabase, verifyPreservation, databaseExpectations } from '../tools/database.js';

test('operator database inspection is readonly, complete and proves protected records across upgrades', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-database-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const current = join(directory, 'current.sqlite'), before = join(directory, 'before.sqlite');
  const fixture = await applicationFixture(scope, current);
  const agent = await fixture.agent(fixture.admin.actor, 'helper');
  copyFileSync(current, before);
  const bytes = readFileSync(current);
  const report = value(inspectDatabase(current, { schemaVersion: 9, counts: { agent: 1, management_conversation: 0 } }, true));
  assert.equal(Object.keys(report.counts).length, 48);
  assert.equal(report.schema?.length, 48);
  assert.equal(report.integrity, 'ok');
  assert(!JSON.stringify(report).includes(agent.token));
  assert.deepEqual(readFileSync(current), bytes);
  assert.equal(inspectDatabase(current, { schemaVersion: 7 }, false).ok, false);
  assert.equal(inspectDatabase(current, { counts: { agent: 0 } }, false).ok, false);
  assert.equal(databaseExpectations({ counts: { 'agent; DROP TABLE agent': 1 } }).ok, false);
  const preserved = value(verifyPreservation(before, current));
  assert.equal(preserved.preserved.agent, 1); assert.equal(preserved.preserved.agent_credential, 1);
  await fixture.member('additional');
  assert(verifyPreservation(before, current).ok, 'New records may be added without losing existing records');
  const database = new Database(current);
  try { executeUpdate(database, schema, (query, params) => query.update('agent').set({ wake_mode: 'everyone' }).where(row => row.principal_id === params.id), { id: agent.id }); }
  finally { database.close(); }
  assert.equal(verifyPreservation(before, current).ok, false);
  const linked = join(directory, 'linked.sqlite'); symlinkSync(current, linked);
  assert.equal(inspectDatabase(linked, {}, false).ok, false);
  chmodSync(before, 0o644); assert.equal(inspectDatabase(before, {}, false).ok, false);
  assert.equal(inspectDatabase(join(directory, 'missing.sqlite'), {}, false).ok, false);
});
