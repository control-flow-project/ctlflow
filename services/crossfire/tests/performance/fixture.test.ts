import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { applicationFixture } from '../../node/tests/support/application.js';
import { populatePerformanceHistory } from './fixture.js';

test('the performance fixture contains valid normalized histories without starting native agents', async scope => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-performance-fixture-'));
  const path = join(root, 'private/management.sqlite');
  try {
    const fixture = await applicationFixture(scope, path);
    const agent = await fixture.agent(fixture.admin.actor, 'performance-analyst');
    fixture.application.close();
    assert.deepEqual(populatePerformanceHistory(path, agent.id), { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 });
    const database = new Database(path, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(database.pragma('foreign_key_check'), []);
      assert.equal(executeSelect(database, schema, query => query.from('listener_run').where(row => row.stopped_at === null).count()), 0);
      assert.equal(executeSelect(database, schema, query => query.from('runtime_observation').where(row => row.state !== 'sleeping').count()), 0);
    } finally { database.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
