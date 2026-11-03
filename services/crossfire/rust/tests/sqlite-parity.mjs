import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { databaseIdentity, foreignKeyViolations, integrityResults } from '@ctlflow/crossfire-database-inspection/schema/metadata';
import { migrationQuery as query, migrationRows as rows, migrationChange as change } from '../../dist/tests/support/migration-data.js';

const [identityBinary, activityBinary] = process.argv.slice(2);
assert(identityBinary && activityBinary && process.argv.length === 4, 'Provide both compiled Rust interchange executables');
const template = process.env.CROSSFIRE_TEST_DATABASE_TEMPLATE;
assert(template, 'Provide the shared Knex-prepared database template');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-rust-sqlite-parity-')); chmodSync(directory, 0o700);
const path = join(directory, 'management.sqlite'); copyFileSync(template, path); chmodSync(path, 0o600);
function native(binary, ...args) {
  assert.equal(readFileSync(binary).subarray(0, 4).toString('hex'), '7f454c46', 'Execute an actual native ELF binary');
  return JSON.parse(execFileSync(resolve(binary), args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 }).trim());
}
function schema(database) {
  assert.deepEqual(databaseIdentity(database), { application: 1129465426, version: 1 });
  assert.deepEqual(foreignKeyViolations(database), []); assert.deepEqual(integrityResults(database), [{ integrity_check: 'ok' }]);
  return rows(database, query('sqlite_schema').select('type', 'name', 'tbl_name', 'sql').where('name', 'not like', 'sqlite_%').orderBy(['type', 'name']));
}
let database;
try {
  database = new Database(path, { fileMustExist: true }); database.pragma('foreign_keys=ON');
  const before = schema(database); database.close(); database = null;
  const ownerId = randomUUID(), written = native(identityBinary, 'write', path, ownerId);
  assert.equal(written.id, ownerId); assert.equal(written.version, 1);
  database = new Database(path, { fileMustExist: true }); database.pragma('foreign_keys=ON');
  assert.equal(rows(database, query('member').where('principal_id', ownerId))[0].display_name, 'Portable native record');
  change(database, query('member').where('principal_id', ownerId).update({ display_name: 'Fixture renamed this member' }));
  const now = 1792000000000, agentId = randomUUID(), fleetId = randomUUID(), runId = randomUUID(), decisionId = randomUUID(), credentialId = randomUUID(), connectionId = randomUUID();
  const bucket = Math.floor(now / 3600000) * 3600000;
  database.transaction(() => {
    change(database, query('principal').insert({ id: agentId, backend_user_id: '@agent:example.test', kind: 'agent', status: 'active', revision: 0, created_at: now }));
    change(database, query('agent').insert({ principal_id: agentId, principal_kind: 'agent', owner_id: ownerId, wake_mode: 'humans' }));
    change(database, query('principal_role').insert({ principal_id: agentId, principal_kind: 'agent', role_code: 'agent', assigned_by_member_id: ownerId, assigned_at: now }));
    change(database, query('principal_application').insert({ principal_id: agentId, next_check_at: now }));
    change(database, query('fleet').insert({ id: fleetId, owner_id: ownerId, fleet_key: 'parity', archived_at: null, delivery_enabled: 1, label: 'Parity', controller_name: 'Parity', revision: 0, created_at: now, updated_at: now }));
    change(database, query('fleet_instance').insert({ owner_id: ownerId, fleet_key: 'parity', instance_key: 'agent', agent_id: agentId, retired_at: null }));
    change(database, query('agent_name').insert({ name: 'parity-agent', agent_id: agentId, request_id: null, instance_key: null }));
    change(database, query('fleet_credential').insert({ id: credentialId, fleet_id: fleetId, secret_hash: createHash('sha256').update('fixture-controller').digest('hex'), created_at: now, revoked_at: null }));
    change(database, query('fleet_connection').insert({ fleet_id: fleetId, credential_id: credentialId, connection_id: connectionId, last_seen_at: now, expires_at: now + 30000, closed_at: null }));
    change(database, query('listener_run').insert({ id: runId, agent_id: agentId, controller_fleet_id: fleetId, controller_connection_id: connectionId, controller_credential_id: credentialId, release: 'parity', started_at: now, last_seen_at: now, active_ms: 0, messages_delivered: 0, stopped_at: now, disconnect_requested_at: null }));
    change(database, query('runtime_decision').insert({ id: decisionId, agent_id: agentId, run_id: runId, runtime: 'codex', session_id: 'native-session', request_id: randomUUID(), turn_id: 'fixture-turn', item_id: 'fixture-item', kind: 'question', action: 'input', review_text: 'Fixture review 🦉', blocking: 1, expires_at: null, status: 'pending', created_at: now }));
    change(database, query('runtime_decision_question').insert({ decision_id: decisionId, question_id: 'question', position: 0, title: 'Proceed', prompt: 'Proceed?', secret: 0, allow_text: 0 }));
    change(database, query('runtime_decision_option').insert({ decision_id: decisionId, question_id: 'question', option_id: 'yes', position: 0, label: 'Yes', description: 'Proceed' }));
    change(database, query('runtime_observation').insert({ run_id: runId, agent_id: agentId, session_id: 'native-session', room_id: null, runtime: 'codex', state: 'idle', observed_at: now, last_activity_at: now, history_available: 1, history_mode: 'shared', max_input_bytes: 65536, error_message: null }));
    change(database, query('runtime_setting').insert({ run_id: runId, session_id: 'native-session', name: 'model', configured_value: 'fixture-model', effective_value: 'fixture-model' }));
    change(database, query('listener_stat_checkpoint').insert({ run_id: runId, sequence: 1, digest: 'a'.repeat(64), captured_at: now }));
    change(database, query('listener_stat_interval').insert({ run_id: runId, bucket_at: bucket, agent_id: agentId, started_at: now, ended_at: now, captured_at: now, dropped: 0 }));
    change(database, query('listener_stat_flow').insert({ run_id: runId, bucket_at: bucket, room_id: '!room:example.test', sender_backend_user_id: '@owner:example.test', message_type: 'm.text', observed: 2, delivered: 1, content_bytes: 120, delivered_bytes: 60, attachment_bytes: 200, largest_bytes: 80 }));
    const tokens = { runtime: 'codex', session_id: 'native-session', input: 100, cached_input: 40, cache_write_input: null, output: 20, reasoning_output: 10, total: 120 };
    change(database, query('listener_stat_usage').insert({ run_id: runId, bucket_at: bucket, ...tokens }));
    change(database, query('runtime_usage_checkpoint').insert({ agent_id: agentId, ...tokens, captured_at: now }));
  })();
  database.close(); database = null;
  const first = native(activityBinary, 'inspect', path, agentId, runId, decisionId);
  assert.equal(first.decisions[0].review, 'Fixture review 🦉'); assert.equal(first.observations[0].state, 'idle'); assert.equal(first.statistics.observed, 2);
  const second = native(activityBinary, 'record', path, agentId, runId, decisionId);
  assert.equal(second.observations[0].state, 'waiting-answer'); assert.equal(second.statistics.observed, 5); assert.equal(second.statistics.tokens.input, 50);
  database = new Database(path, { fileMustExist: true }); database.pragma('foreign_keys=ON');
  assert.equal(rows(database, query('member').where('principal_id', ownerId))[0].display_name, 'Fixture renamed this member');
  assert.equal(rows(database, query('runtime_decision').where('id', decisionId))[0].status, 'answered');
  assert.deepEqual(rows(database, query('runtime_decision_answer').where('decision_id', decisionId).select('question_id', 'option_id', 'answer_text')), [{ question_id: 'question', option_id: 'yes', answer_text: null }]);
  const decisions = rows(database, query('runtime_decision').where('agent_id', agentId).orderBy('created_at', 'desc'));
  assert.equal(decisions.length, 2); assert.equal(decisions[0].review_text, 'Native Rust review 🦉');
  assert.equal(rows(database, query('runtime_decision_option').where('decision_id', decisions[0].id))[0].option_id, 'yes');
  const flow = rows(database, query('listener_stat_flow').where('run_id', runId))[0];
  assert.equal(flow.observed, 5); assert.equal(flow.content_bytes, 320); assert.equal(flow.attachment_bytes, 600); assert.equal(flow.largest_bytes, 100);
  const usage = rows(database, query('listener_stat_usage').where('run_id', runId))[0];
  assert.equal(usage.input, 50); assert.equal(usage.cached_input, 20); assert.equal(usage.reasoning_output, 5);
  assert.deepEqual(schema(database), before, 'Application writes never mutate schema or Knex metadata');
  console.log(JSON.stringify({ status: 'passed', directions: ['Knex fixture→Rust', 'Rust→read-only fixture'], capabilities: ['identity', 'roles', 'questions', 'answers', 'observations', 'settings', 'traffic', 'token-checkpoints'], schema: 'unchanged' }));
} finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
