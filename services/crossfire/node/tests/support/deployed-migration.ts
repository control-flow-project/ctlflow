import type Database from 'better-sqlite3';
import { openTestStore } from './storage.js';
import { schema13Store } from './schema13.js';
import { restoreSchema14EnrollmentItems } from './schema14.js';
import { restoreSchema16Logging } from './schema16.js';
import { migrationChange, migrationQuery } from './migration-data.js';

export function seedWakeHistory(database: Database.Database): void {
  migrationChange(database, migrationQuery('principal').insert([
    { id: 'owner', matrix_user_id: '@owner:test', kind: 'human', status: 'active', revision: 7, created_at: 12 },
    { id: 'other', matrix_user_id: '@other:test', kind: 'human', status: 'active', revision: 0, created_at: 12 },
  ]));
  migrationChange(database, migrationQuery('member').insert([
    { principal_id: 'owner', principal_kind: 'human', display_name: 'Private owner' },
    { principal_id: 'other', principal_kind: 'human', display_name: 'Other' },
  ]));
  migrationChange(database, migrationQuery('enrollment_request').insert({ controller_name: 'Computer', controller_credential_hash: 'private-controller-hash',
    fleet_key: 'fleet', id: 'request', owner_id: 'owner', verification_code: 'CODE00000000', claim_hash: 'private-claim', roster_digest: 'digest',
    status: 'pending', revision: 0, created_at: 12, expires_at: 600, decided_by_member_id: null, decided_at: null }));
  migrationChange(database, migrationQuery('enrollment_archive').insert({ controller_name: null, controller_credential_hash: null, fleet_key: null,
    id: 'archive', owner_id: 'owner', verification_code: 'CODE00000001', claim_hash: 'archived-claim', roster_digest: 'retained-historical-digest',
    status: 'approved', revision: 1, created_at: 12, expires_at: 600, decided_by_member_id: 'owner', decided_at: 14 }));
  for (const mode of ['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected']) {
    const agentId = 'agent-' + mode;
    migrationChange(database, migrationQuery('principal').insert({ id: agentId, matrix_user_id: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 9, created_at: 12 }));
    migrationChange(database, migrationQuery('agent').insert({ principal_id: agentId, principal_kind: 'agent', owner_id: 'owner', display_name_override: null, wake_mode: mode }));
    migrationChange(database, migrationQuery('agent_credential').insert({ agent_id: agentId, provisioning_password: 'private-password-' + mode, access_token: 'private-token-' + mode, updated_at: 12 }));
    migrationChange(database, migrationQuery('agent_name').insert({ name: mode, request_id: null, instance_key: null, agent_id: agentId }));
    for (const prefix of ['item', 'archive']) {
      const requestId = prefix === 'item' ? 'request' : 'archive';
      migrationChange(database, migrationQuery(prefix === 'item' ? 'enrollment_item' : 'enrollment_archive_item')
        .insert({ request_id: requestId, instance_key: mode, requested_name: mode, outcome: 'existing', agent_id: agentId, failure_code: null }));
      migrationChange(database, migrationQuery('enrollment_' + prefix + '_policy')
        .insert({ request_id: requestId, instance_key: mode, wake_mode: mode, expected_agent_revision: 9 }));
    }
    if (mode === 'selected') {
      migrationChange(database, migrationQuery('agent_wake_sender').insert({ agent_id: agentId, sender_principal_id: 'other' }));
      for (const prefix of ['item', 'archive']) migrationChange(database, migrationQuery('enrollment_' + prefix + '_wake_sender')
        .insert({ request_id: prefix === 'item' ? 'request' : 'archive', instance_key: mode, sender_principal_id: 'other' }));
    }
  }
  migrationChange(database, migrationQuery('fleet').insert({ id: 'fleet', owner_id: 'owner', fleet_key: 'fleet', label: 'Private fleet', controller_name: 'Computer',
    archived_at: null, delivery_enabled: 1, revision: 4, created_at: 12, updated_at: 12 }));
  migrationChange(database, migrationQuery('fleet_instance').insert({ owner_id: 'owner', fleet_key: 'fleet', instance_key: 'selected', agent_id: 'agent-selected', retired_at: null }));
  migrationChange(database, migrationQuery('agent_room_grant').insert({ agent_id: 'agent-selected', room_id: '!matter:test', generation: 'generation', authorizer_id: 'owner',
    added_by_id: 'owner', invitation_event_id: null, admission_kind: 'managed', access_mode: 'reply', power_level: null, muted: 0, revision: 3, access_revision: 1, updated_at: 12 }));
  migrationChange(database, migrationQuery('agent_room_permission').insert({ agent_id: 'agent-selected', room_id: '!matter:test', generation: 'generation',
    permission_code: 'room.agent.invite', grant_scope: 'agent_room', granted_by_member_id: 'owner', granted_at: 12 }));
  for (const prefix of ['item', 'archive']) migrationChange(database, migrationQuery('enrollment_' + prefix + '_permission')
    .insert({ request_id: prefix === 'item' ? 'request' : 'archive', instance_key: 'selected', permission_code: 'room.agent.invite', grant_scope: 'agent_room' }));
  migrationChange(database, migrationQuery('enrollment_controller_metadata').insert({ enrollment_id: 'request', key: 'zone', value: 'local' }));
}

export function schema14Store(): Database.Database {
  const database = openTestStore();
  database.pragma('foreign_keys=ON'); restoreSchema14EnrollmentItems(database); restoreSchema16Logging(database);
  migrationChange(database, migrationQuery.schema.alterTable('agent', table => table.text('display_name_override')));
  migrationChange(database, migrationQuery('principal').insert([
    { id: 'owner', matrix_user_id: '@owner:test', kind: 'human', status: 'active', revision: 4, created_at: 1 },
    { id: 'agent', matrix_user_id: '@agent:test', kind: 'agent', status: 'active', revision: 7, created_at: 1 },
  ]));
  migrationChange(database, migrationQuery('member').insert({ principal_id: 'owner', principal_kind: 'human', display_name: 'Owner' }));
  migrationChange(database, migrationQuery('agent').insert({ principal_id: 'agent', principal_kind: 'agent', owner_id: 'owner', wake_mode: 'selected' }));
  migrationChange(database, migrationQuery('agent_credential').insert({ agent_id: 'agent', provisioning_password: 'private-password', access_token: 'private-token', updated_at: 1 }));
  migrationChange(database, migrationQuery('fleet').insert({ archived_at: null, id: 'fleet', delivery_enabled: 1, label: 'Fleet', controller_name: 'Computer',
    revision: 2, updated_at: 1, owner_id: 'owner', fleet_key: 'fleet', created_at: 1 }));
  migrationChange(database, migrationQuery('fleet_instance').insert({ retired_at: null, owner_id: 'owner', fleet_key: 'fleet', instance_key: 'saved', agent_id: 'agent' }));
  migrationChange(database, migrationQuery('fleet_credential').insert({ id: 'partial', fleet_id: 'fleet', secret_hash: 'retained-private-hash', created_at: 1, revoked_at: null }));
  const requests = [
    { id: 'partial', controller_credential_hash: 'retained-private-hash', verification_code: 'PARTIALCODE1', claim_hash: 'private-claim', roster_digest: 'roster', status: 'approved', revision: 1, decided_by_member_id: 'owner', decided_at: 2 },
    { id: 'pending', controller_credential_hash: 'pending-hash', verification_code: 'PENDINGCODE1', claim_hash: 'pending-claim', roster_digest: 'pending-roster', status: 'pending', revision: 0, decided_by_member_id: null, decided_at: null },
    { id: 'current', controller_credential_hash: 'exact-hash', verification_code: 'CURRENTCODE1', claim_hash: 'exact-claim', roster_digest: 'exact-roster', status: 'pending', revision: 0, decided_by_member_id: null, decided_at: null },
  ];
  migrationChange(database, migrationQuery('enrollment_request').insert(requests.map(row => ({ ...row, controller_name: 'Computer', owner_id: 'owner', fleet_key: 'fleet', created_at: 1, expires_at: 100 }))));
  const items = [
    { request_id: 'partial', instance_key: 'saved', outcome: 'existing', agent_id: 'agent', failure_code: null },
    { request_id: 'partial', instance_key: 'collision', outcome: 'failed', agent_id: null, failure_code: 'name_collision' },
    { request_id: 'pending', instance_key: 'claimed', outcome: 'claimed', agent_id: null, failure_code: null },
    { request_id: 'pending', instance_key: 'capacity', outcome: 'failed', agent_id: null, failure_code: 'capacity' },
    { request_id: 'current', instance_key: 'exact', outcome: 'claimed', agent_id: null, failure_code: null },
  ];
  migrationChange(database, migrationQuery('enrollment_item').insert(items.map(row => ({ ...row, requested_name: row.instance_key }))));
  migrationChange(database, migrationQuery('agent_name').insert([
    { name: 'saved', request_id: null, instance_key: null, agent_id: 'agent' },
    { name: 'claimed', request_id: 'pending', instance_key: 'claimed', agent_id: null },
    { name: 'exact', request_id: 'current', instance_key: 'exact', agent_id: null },
  ]));
  migrationChange(database, migrationQuery('enrollment_item_policy').insert(items.map(row => ({ request_id: row.request_id, instance_key: row.instance_key,
    wake_mode: 'selected', expected_agent_revision: row.agent_id ? 7 : null }))));
  for (const requestId of ['partial', 'pending']) {
    const instanceKey = requestId === 'partial' ? 'saved' : 'claimed';
    migrationChange(database, migrationQuery('enrollment_item_permission').insert({ request_id: requestId, instance_key: instanceKey, permission_code: 'room.agent.invite', grant_scope: 'agent_room' }));
    migrationChange(database, migrationQuery('enrollment_item_wake_sender').insert({ request_id: requestId, instance_key: instanceKey, sender_principal_id: 'owner', include_agents: requestId === 'partial' ? 1 : 0 }));
    migrationChange(database, migrationQuery('enrollment_controller_metadata').insert({ enrollment_id: requestId, key: 'label', value: requestId === 'partial' ? 'Exact private historical metadata' : 'Pending metadata' }));
  }
  database.pragma('user_version=14');
  return database;
}

export function deployedMigrationFixture(version: 13 | 14): Database.Database {
  if (version === 14) return schema14Store();
  const database = schema13Store(); seedWakeHistory(database); return database;
}
