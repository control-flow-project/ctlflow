import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { foreignKeyViolations } from '@ctlflow/crossfire-database-inspection/schema/metadata';
import { migrationQuery as query, migrationRows as rows, migrationChange as change } from '../support/migration-data.js';
import { populatePerformanceHistory } from './fixture.js';

test('the performance fixture contains valid normalized histories without starting native agents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-performance-fixture-'));
  const path = join(root, 'management.sqlite');
  try {
    await migrateDatabase(path);
    const database = new Database(path, { fileMustExist: true });
    try {
      database.pragma('foreign_keys=ON');
      change(database, query('principal').insert([{ id: 'owner', backend_user_id: '@owner:test', kind: 'human', status: 'active', revision: 0, created_at: 1 }, { id: 'agent', backend_user_id: '@agent:test', kind: 'agent', status: 'active', revision: 0, created_at: 1 }]));
      change(database, query('member').insert({ principal_id: 'owner', principal_kind: 'human', display_name: 'Owner' }));
      change(database, query('agent').insert({ principal_id: 'agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected' }));
      change(database, query('fleet').insert({ id: 'fleet', owner_id: 'owner', fleet_key: 'performance', archived_at: null, delivery_enabled: 1, label: 'Performance', controller_name: 'Performance', revision: 0, created_at: 1, updated_at: 1 }));
      change(database, query('fleet_instance').insert({ owner_id: 'owner', fleet_key: 'performance', instance_key: 'agent', agent_id: 'agent', retired_at: null }));
      change(database, query('fleet_credential').insert({ id: 'credential', fleet_id: 'fleet', secret_hash: 'a'.repeat(64), created_at: 1, revoked_at: null }));
      change(database, query('principal_application').insert({ principal_id: 'agent', next_check_at: 1 }));
    } finally { database.close(); }
    assert.deepEqual(populatePerformanceHistory(path, 'agent'), { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 });
    const reader = new Database(path, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(foreignKeyViolations(reader), []);
      assert.equal(rows(reader, query('listener_run').whereNull('stopped_at')).length, 0);
      assert.equal(rows(reader, query('runtime_observation').whereNot('state', 'sleeping')).length, 0);
    } finally { reader.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
