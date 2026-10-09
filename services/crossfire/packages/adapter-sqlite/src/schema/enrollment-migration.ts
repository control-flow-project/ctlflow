import type Database from 'better-sqlite3';
import { executeDelete, executeInsert, executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { createSchema } from '@tinqerjs/tinqer';
import { enrollmentSchema } from './enrollment.js';
import { type Tables } from './tables.js';

const prior = createSchema<Omit<Tables, 'enrollment_item'> & { enrollment_item: Tables['enrollment_archive_item'];
  enrollment_item_next: Tables['enrollment_item'] }>();

function archivePartialRosters(database: Database.Database): void {
  const failed = executeSelect(database, prior, query => query.from('enrollment_item').where(row => row.outcome === 'failed'));
  for (const requestId of new Set(failed.map(item => item.request_id))) {
    const key = { requestId };
    const request = executeSelect(database, prior, (query, params) => query.from('enrollment_request').where(row => row.id === params.requestId).first(), key);
    executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive').values({
      id: params.id, owner_id: params.owner_id, controller_name: params.controller_name, controller_credential_hash: params.controller_credential_hash,
      fleet_key: params.fleet_key, verification_code: params.verification_code, claim_hash: params.claim_hash, roster_digest: params.roster_digest,
      status: params.status, revision: params.revision, created_at: params.created_at, expires_at: params.expires_at,
      decided_by_member_id: params.decided_by_member_id, decided_at: params.decided_at }), request);
    const items = executeSelect(database, prior, (query, params) => query.from('enrollment_item').where(row => row.request_id === params.requestId), key);
    for (const item of items) executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive_item').values({
      request_id: params.request_id, instance_key: params.instance_key, requested_name: params.requested_name, outcome: params.outcome,
      agent_id: params.agent_id, failure_code: params.failure_code }), item);
    const policies = executeSelect(database, prior, (query, params) => query.from('enrollment_item_policy').where(row => row.request_id === params.requestId), key);
    for (const policy of policies) executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive_policy').values({
      request_id: params.request_id, instance_key: params.instance_key, wake_mode: params.wake_mode, expected_agent_revision: params.expected_agent_revision }), policy);
    const permissions = executeSelect(database, prior, (query, params) => query.from('enrollment_item_permission').where(row => row.request_id === params.requestId), key);
    for (const permission of permissions) executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive_permission').values({
      request_id: params.request_id, instance_key: params.instance_key, permission_code: params.permission_code, grant_scope: params.grant_scope }), permission);
    const senders = executeSelect(database, prior, (query, params) => query.from('enrollment_item_wake_sender').where(row => row.request_id === params.requestId), key);
    for (const sender of senders) executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive_wake_sender').values({
      request_id: params.request_id, instance_key: params.instance_key, sender_principal_id: params.sender_principal_id, include_agents: params.include_agents }), sender);
    const metadata = executeSelect(database, prior, (query, params) => query.from('enrollment_controller_metadata').where(row => row.enrollment_id === params.requestId), key);
    for (const entry of metadata) executeInsert(database, prior, (query, params) => query.insertInto('enrollment_archive_metadata').values({
      enrollment_id: params.enrollment_id, key: params.key, value: params.value }), entry);
    executeDelete(database, prior, (query, params) => query.deleteFrom('agent_name').where(row => row.request_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_item_permission').where(row => row.request_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_item_wake_sender').where(row => row.request_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_item_policy').where(row => row.request_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_controller_metadata').where(row => row.enrollment_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_item').where(row => row.request_id === params.requestId), key);
    executeDelete(database, prior, (query, params) => query.deleteFrom('enrollment_request').where(row => row.id === params.requestId), key);
  }
}

export function migrateEnrollmentItems(database: Database.Database): void {
  archivePartialRosters(database);
  const start = enrollmentSchema.indexOf('CREATE TABLE enrollment_item ('), end = enrollmentSchema.indexOf('CREATE TABLE agent_name (');
  const definition = enrollmentSchema.slice(start, end).trim();
  if (start < 0 || end < start) throw new Error('Canonical enrollment schema is missing');
  database.exec(definition.replace('CREATE TABLE enrollment_item', 'CREATE TABLE enrollment_item_next')
    .replace('ON enrollment_item(', 'ON enrollment_item_next(').replace('ix_enrollment_item_agent', 'ix_enrollment_item_agent_next'));
  const items = executeSelect(database, prior, query => query.from('enrollment_item'));
  for (const item of items) {
    if (item.outcome === 'failed' || item.failure_code !== null) throw new Error('A partially admitted roster was not archived');
    executeInsert(database, prior, (query, params) => query.insertInto('enrollment_item_next').values({ request_id: params.request_id,
      instance_key: params.instance_key, requested_name: params.requested_name, outcome: params.outcome, agent_id: params.agent_id }),
    { ...item, outcome: item.outcome });
  }
  database.exec('DROP TABLE enrollment_item; ALTER TABLE enrollment_item_next RENAME TO enrollment_item; DROP INDEX ix_enrollment_item_agent_next;');
  database.exec(definition.slice(definition.indexOf('CREATE INDEX')));
}
