import { openTestStore, statisticsSchema } from './storage.js';
import { restoreSchema16Logging } from './schema16.js';
import { migrationChange, migrationQuery } from './migration-data.js';

export function schema15Store(file = ':memory:') {
  const database = openTestStore(file);
  restoreSchema16Logging(database);
  migrationChange(database, migrationQuery.schema.dropTable('listener_stat_usage').dropTable('runtime_usage_checkpoint'));
  const start = statisticsSchema.indexOf('CREATE TABLE listener_stat_usage');
  database.exec(statisticsSchema.slice(start).replace('reasoning_output INTEGER CHECK', 'reasoning_output INTEGER NOT NULL CHECK').replace('reasoning_output INTEGER,', 'reasoning_output INTEGER NOT NULL,'));
  database.pragma('user_version=15');
  migrationChange(database, migrationQuery('principal').insert([
    { id: 'owner', matrix_user_id: '@owner:test', kind: 'human', status: 'active', revision: 0, created_at: 1 },
    { id: 'retained-agent', matrix_user_id: '@agent:test', kind: 'agent', status: 'active', revision: 0, created_at: 1 },
  ]));
  migrationChange(database, migrationQuery('member').insert({ principal_id: 'owner', principal_kind: 'human', display_name: 'Owner' }));
  migrationChange(database, migrationQuery('agent').insert({ principal_id: 'retained-agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected' }));
  database.pragma('foreign_keys=ON');
  migrationChange(database, migrationQuery('runtime_usage_checkpoint').insert({ agent_id: 'retained-agent', runtime: 'codex', session_id: 'original-history',
    input: 100, cached_input: 20, cache_write_input: null, output: 30, reasoning_output: 10, total: 130, captured_at: 1 }));
  return database;
}
