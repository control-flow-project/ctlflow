import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { databaseValid } from '@ctlflow/crossfire-database-inspection/schema/metadata';
import { migrationQuery as query, migrationRows as rows, migrationChange as change } from '../support/migration-data.js';

// Knex fixture builders populate the shared schema; no service implementation runs in the test process.
export function populatePerformanceHistory(file: string, agentId: string) {
  const database = new Database(file, { fileMustExist: true });
  try {
    database.pragma('foreign_keys=ON'); database.pragma('synchronous=FULL');
    const binding = rows(database, query('fleet_instance').where('agent_id', agentId))[0]; assert(binding);
    const fleet = rows(database, query('fleet').where({ owner_id: binding.owner_id, fleet_key: binding.fleet_key }))[0]; assert(fleet);
    assert.equal(typeof fleet.id, 'string');
    const credential = rows(database, query('fleet_credential').where('fleet_id', fleet.id as string).whereNull('revoked_at'))[0]; assert(credential);
    const applied = rows(database, query('principal_application').where('principal_id', agentId))[0]; assert(applied);
    const now = Date.now(), started = now - 2 * 86400000, connectionId = randomUUID();
    database.transaction(() => {
      for (let index = 0; index < 50; index++) {
        const id = index === 0 ? agentId : randomUUID();
        if (index !== 0) {
          change(database, query('principal').insert({ id, backend_user_id: '@performance-' + index + ':architecture.localhost', kind: 'agent', status: 'active', revision: 0, created_at: started }));
          change(database, query('agent').insert({ principal_id: id, principal_kind: 'agent', owner_id: binding.owner_id, wake_mode: 'selected' }));
          change(database, query('agent_name').insert({ name: 'performance-' + index, agent_id: id, request_id: null, instance_key: null }));
          change(database, query('principal_role').insert({ principal_id: id, principal_kind: 'agent', role_code: 'agent', assigned_by_member_id: binding.owner_id, assigned_at: started }));
          change(database, query('principal_application').insert({ ...applied, principal_id: id, next_check_at: now + 86400000, error_code: null, error_message: null }));
          change(database, query('fleet_instance').insert({ owner_id: binding.owner_id, fleet_key: binding.fleet_key, instance_key: 'performance-' + index, agent_id: id, retired_at: null }));
        }
        for (let history = 0; history < 1000; history++) {
          const runId = randomUUID(), at = started + history;
          change(database, query('listener_run').insert({ id: runId, agent_id: id, release: 'performance-history',
            controller_fleet_id: fleet.id, controller_connection_id: connectionId, controller_credential_id: credential.id,
            started_at: at, last_seen_at: at, active_ms: 0, messages_delivered: 0, stopped_at: at, disconnect_requested_at: null }));
          change(database, query('runtime_observation').insert({ run_id: runId, agent_id: id, session_id: 'saved-context', room_id: null,
            runtime: 'codex', state: 'sleeping', observed_at: at, history_mode: 'shared', max_input_bytes: 65536,
            error_message: null, last_activity_at: at, history_available: 1 }));
        }
      }
    })();
    assert.equal(databaseValid(database), true, 'The populated fixture preserves database integrity and every relationship');
    function count(table: string): number { const result = rows(database, query(table).count({ total: '*' }))[0]; assert(result && typeof result.total === 'number'); return result.total; }
    return { agents: count('agent'), listenerRuns: count('listener_run'), runtimeObservations: count('runtime_observation') };
  } finally { database.close(); }
}
