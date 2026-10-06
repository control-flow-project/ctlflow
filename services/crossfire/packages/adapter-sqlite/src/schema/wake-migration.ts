import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { executeSelect, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { enrollmentRosterValue } from '@ctlflow/crossfire-domain/enrollment/roster-digest';
import { createFleetPolicyRepository } from '../repository/fleet-policy/index.js';
import { identitySchema } from './identity.js';
import { roomAccessSchema } from './room-access.js';
import { fleetPolicySchema } from './fleet-policy.js';
import { enrollmentArchiveSchema, enrollmentArchiveGuards } from './controller.js';
import { schema } from './tables.js';

function tableSchema(source: string, table: string): string {
  const start = source.indexOf('CREATE TABLE ' + table + ' (');
  const end = source.indexOf('CREATE TABLE ', start + 1);
  if (start < 0) throw new Error('Missing canonical table schema');
  return source.slice(start, end < 0 ? undefined : end).trim();
}

function updatePendingDigests(database: Database.Database): void {
  const policies = createFleetPolicyRepository(database);
  const requests = executeSelect(database, schema, query => query.from('enrollment_request').where(row => row.status === 'pending'));
  for (const request of requests) {
    const principal = executeSelect(database, schema, (query, params) => query.from('principal').where(row => row.id === params.ownerId).first(), { ownerId: request.owner_id });
    const items = executeSelect(database, schema, (query, params) => query.from('enrollment_item').where(row => row.request_id === params.requestId), { requestId: request.id });
    const metadata = executeSelect(database, schema, (query, params) => query.from('enrollment_controller_metadata').where(row => row.enrollment_id === params.requestId), { requestId: request.id });
    const requested = policies.requested(request.id);
    if (!requested.ok || requested.value.length !== items.length) throw new Error('Pending enrollment has incomplete wake authority');
    const value = enrollmentRosterValue({ ownerMatrixId: principal.matrix_user_id, fleetKey: request.fleet_key,
      controller: { name: request.controller_name, metadata: Object.fromEntries(metadata.map(entry => [entry.key, entry.value])) },
      instances: items.map(item => {
        const policy = requested.value.find(entry => entry.instanceKey === item.instance_key);
        if (!policy) throw new Error('Pending enrollment policy is missing');
        return { instanceKey: item.instance_key, name: item.requested_name, agentId: item.outcome === 'existing' ? item.agent_id : null,
          coordinationPolicy: { wakeMode: policy.wakeMode, senders: policy.matrixSenders, permissions: policy.permissions } };
      }) });
    executeUpdate(database, schema, (query, params) => query.update('enrollment_request').set({ roster_digest: params.digest })
      .where(row => row.id === params.requestId), { requestId: request.id, digest: createHash('sha256').update(value).digest('hex') });
  }
}

export function migrateWakeSchema(database: Database.Database): void {
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      for (const table of ['enrollment_archive_policy', 'enrollment_archive_wake_sender']) {
        database.exec('DROP TRIGGER protect_' + table + '_update; DROP TRIGGER protect_' + table + '_delete;');
      }
      const definitions = [tableSchema(identitySchema, 'agent'), tableSchema(roomAccessSchema, 'agent_wake_sender'),
        tableSchema(fleetPolicySchema, 'enrollment_item_policy'), tableSchema(fleetPolicySchema, 'enrollment_item_wake_sender'),
        tableSchema(enrollmentArchiveSchema, 'enrollment_archive_policy'), tableSchema(enrollmentArchiveSchema, 'enrollment_archive_wake_sender')];
      for (const definition of definitions) {
        const table = /^CREATE TABLE ([a-z_]+)/u.exec(definition)![1]!;
        database.exec(definition.replace('CREATE TABLE ' + table, 'CREATE TABLE ' + table + '_next')
          .replaceAll('ON ' + table + '(', 'ON ' + table + '_next(')
          .replace(/CREATE INDEX ([a-z_]+)/gu, 'CREATE INDEX $1_next'));
      }
      database.exec(`
INSERT INTO agent_next SELECT principal_id,principal_kind,owner_id,display_name_override,
 CASE WHEN wake_mode IN ('humans','everyone') THEN wake_mode ELSE 'selected' END FROM agent;
INSERT INTO agent_wake_sender_next SELECT sender.agent_id,sender.sender_principal_id,0
 FROM agent_wake_sender AS sender JOIN agent ON agent.principal_id=sender.agent_id WHERE agent.wake_mode='selected';
INSERT INTO agent_wake_sender_next SELECT principal_id,owner_id,CASE WHEN wake_mode='owner' THEN 0 ELSE 1 END
 FROM agent WHERE wake_mode IN ('owner','owner-agents','humans');
`);
      for (const [policy, sender, request] of [['enrollment_item_policy', 'enrollment_item_wake_sender', 'enrollment_request'],
        ['enrollment_archive_policy', 'enrollment_archive_wake_sender', 'enrollment_archive']]) {
        database.exec(`
INSERT INTO ${policy}_next SELECT request_id,instance_key,
 CASE WHEN wake_mode IN ('humans','everyone') THEN wake_mode ELSE 'selected' END,expected_agent_revision FROM ${policy};
INSERT INTO ${sender}_next SELECT sender.request_id,sender.instance_key,sender.sender_principal_id,0
 FROM ${sender} AS sender JOIN ${policy} AS policy ON policy.request_id=sender.request_id AND policy.instance_key=sender.instance_key
 WHERE policy.wake_mode='selected';
INSERT INTO ${sender}_next SELECT policy.request_id,policy.instance_key,request.owner_id,CASE WHEN policy.wake_mode='owner' THEN 0 ELSE 1 END
 FROM ${policy} AS policy JOIN ${request} AS request ON request.id=policy.request_id WHERE policy.wake_mode IN ('owner','owner-agents','humans');
`);
      }
      for (const definition of definitions) {
        const table = /^CREATE TABLE ([a-z_]+)/u.exec(definition)![1]!;
        database.exec('DROP TABLE ' + table + '; ALTER TABLE ' + table + '_next RENAME TO ' + table + ';');
        for (const index of definition.matchAll(/CREATE INDEX ([a-z_]+)[^;]+;/gu)) {
          database.exec('DROP INDEX ' + index[1] + '_next; ' + index[0]);
        }
      }
      database.exec(enrollmentArchiveGuards.split('CREATE TRIGGER').filter(fragment => /^ protect_enrollment_archive_(policy|wake_sender)_/u.test(fragment))
        .map(fragment => 'CREATE TRIGGER' + fragment).join(''));
      updatePendingDigests(database);
      const violations = database.pragma('foreign_key_check');
      if (!Array.isArray(violations) || violations.length !== 0) throw new Error('Wake migration would violate retained relational history');
      database.pragma('user_version = 14');
    }).immediate();
  } finally { database.pragma('foreign_keys = ' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
