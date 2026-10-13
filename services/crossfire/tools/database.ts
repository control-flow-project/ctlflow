import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { createSchema, SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/create-schema';
import { retentionProof, recordIdentity, type RetentionProof } from './database-retention.js';

function counts(database: Database.Database) {
  return {
    enrollment_archive: () => executeSelect(database, schema, query => query.from('enrollment_archive').count()),
    enrollment_archive_item: () => executeSelect(database, schema, query => query.from('enrollment_archive_item').count()),
    enrollment_archive_policy: () => executeSelect(database, schema, query => query.from('enrollment_archive_policy').count()),
    enrollment_archive_permission: () => executeSelect(database, schema, query => query.from('enrollment_archive_permission').count()),
    enrollment_archive_wake_sender: () => executeSelect(database, schema, query => query.from('enrollment_archive_wake_sender').count()),
    enrollment_archive_metadata: () => executeSelect(database, schema, query => query.from('enrollment_archive_metadata').count()),
    fleet_native_stop: () => executeSelect(database, schema, query => query.from('fleet_native_stop').count()),
    publication: () => executeSelect(database, schema, query => query.from('publication').count()),
    publication_file: () => executeSelect(database, schema, query => query.from('publication_file').count()),
    listener_stat_checkpoint: () => executeSelect(database, schema, query => query.from('listener_stat_checkpoint').count()),
    listener_stat_interval: () => executeSelect(database, schema, query => query.from('listener_stat_interval').count()),
    listener_stat_flow: () => executeSelect(database, schema, query => query.from('listener_stat_flow').count()),
    listener_stat_usage: () => executeSelect(database, schema, query => query.from('listener_stat_usage').count()),
    runtime_usage_checkpoint: () => executeSelect(database, schema, query => query.from('runtime_usage_checkpoint').count()),
    principal: () => executeSelect(database, schema, query => query.from('principal').count()),
    member: () => executeSelect(database, schema, query => query.from('member').count()),
    agent: () => executeSelect(database, schema, query => query.from('agent').count()),
    agent_credential: () => executeSelect(database, schema, query => query.from('agent_credential').count()),
    principal_application: () => executeSelect(database, schema, query => query.from('principal_application').count()),
    permission: () => executeSelect(database, schema, query => query.from('permission').count()),
    role: () => executeSelect(database, schema, query => query.from('role').count()),
    role_permission: () => executeSelect(database, schema, query => query.from('role_permission').count()),
    principal_role: () => executeSelect(database, schema, query => query.from('principal_role').count()),
    agent_name: () => executeSelect(database, schema, query => query.from('agent_name').count()),
    enrollment_request: () => executeSelect(database, schema, query => query.from('enrollment_request').count()),
    enrollment_item: () => executeSelect(database, schema, query => query.from('enrollment_item').count()),
    enrollment_item_policy: () => executeSelect(database, schema, query => query.from('enrollment_item_policy').count()),
    enrollment_item_permission: () => executeSelect(database, schema, query => query.from('enrollment_item_permission').count()),
    enrollment_item_wake_sender: () => executeSelect(database, schema, query => query.from('enrollment_item_wake_sender').count()),
    enrollment_controller_metadata: () => executeSelect(database, schema, query => query.from('enrollment_controller_metadata').count()),
    instance_policy: () => executeSelect(database, schema, query => query.from('instance_policy').count()),
    agent_wake_sender: () => executeSelect(database, schema, query => query.from('agent_wake_sender').count()),
    agent_room_grant: () => executeSelect(database, schema, query => query.from('agent_room_grant').count()),
    agent_room_permission: () => executeSelect(database, schema, query => query.from('agent_room_permission').count()),
    room_grant_application: () => executeSelect(database, schema, query => query.from('room_grant_application').count()),
    listener_run: () => executeSelect(database, schema, query => query.from('listener_run').count()),
    wake_notice: () => executeSelect(database, schema, query => query.from('wake_notice').count()),
    member_session: () => executeSelect(database, schema, query => query.from('member_session').count()),
    member_invitation: () => executeSelect(database, schema, query => query.from('member_invitation').count()),
    audit_event: () => executeSelect(database, schema, query => query.from('audit_event').count()),
    fleet: () => executeSelect(database, schema, query => query.from('fleet').count()),
    fleet_instance: () => executeSelect(database, schema, query => query.from('fleet_instance').count()),
    fleet_instance_policy: () => executeSelect(database, schema, query => query.from('fleet_instance_policy').count()),
    fleet_instance_permission: () => executeSelect(database, schema, query => query.from('fleet_instance_permission').count()),
    fleet_controller_metadata: () => executeSelect(database, schema, query => query.from('fleet_controller_metadata').count()),
    fleet_credential: () => executeSelect(database, schema, query => query.from('fleet_credential').count()),
    fleet_connection: () => executeSelect(database, schema, query => query.from('fleet_connection').count()),
    fleet_message: () => executeSelect(database, schema, query => query.from('fleet_message').count()),
    fleet_message_delivery: () => executeSelect(database, schema, query => query.from('fleet_message_delivery').count()),
    fleet_runtime_operation: () => executeSelect(database, schema, query => query.from('fleet_runtime_operation').count()),
    wake_rule: () => executeSelect(database, schema, query => query.from('wake_rule').count()),
    wake_rule_agent: () => executeSelect(database, schema, query => query.from('wake_rule_agent').count()),
    wake_delivery: () => executeSelect(database, schema, query => query.from('wake_delivery').count()),
    agent_owner_conversation: () => executeSelect(database, schema, query => query.from('agent_owner_conversation').count()),
    management_conversation: () => executeSelect(database, schema, query => query.from('management_conversation').count()),
    runtime_decision: () => executeSelect(database, schema, query => query.from('runtime_decision').count()),
    runtime_decision_question: () => executeSelect(database, schema, query => query.from('runtime_decision_question').count()),
    runtime_decision_option: () => executeSelect(database, schema, query => query.from('runtime_decision_option').count()),
    runtime_decision_answer: () => executeSelect(database, schema, query => query.from('runtime_decision_answer').count()),
    runtime_observation: () => executeSelect(database, schema, query => query.from('runtime_observation').count()),
    runtime_setting: () => executeSelect(database, schema, query => query.from('runtime_setting').count()),
    runtime_incident: () => executeSelect(database, schema, query => query.from('runtime_incident').count()),
    incident_notification: () => executeSelect(database, schema, query => query.from('incident_notification').count()),
  };
}

export const databaseExpectations = check.object({ schemaVersion: check.optional(check.integer()),
  counts: check.optional(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid', 'Expected table/count pairs');
    const values: Record<string, number> = {};
    for (const [name, count] of Object.entries(input)) {
      const parsed = check.integer()(count); if (!parsed.ok) return parsed;
      if (!/^[a-z][a-z_]*$/u.test(name)) return failure('invalid', 'Invalid table name');
      values[name] = parsed.value;
    }
    return success(values);
  }) });

export function inspectDatabase(file: string, expected: check.Parsed<typeof databaseExpectations>, includeSchema: boolean) {
  let database: Database.Database | undefined;
  try {
    const info = lstatSync(file);
    if (!file.startsWith('/') || realpathSync(file) !== resolve(file) || !info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077) return failure('invalid', 'Use an existing absolute private owned non-symlink database');
    database = new Database(file, { readonly: true, fileMustExist: true });
    const selected = database;
    return selected.transaction(() => {
      if (selected.pragma('application_id', { simple: true }) !== 1129465426) return failure('invalid', 'Not a Crossfire database; nothing was changed');
      const version = selected.pragma('user_version', { simple: true });
      if (expected.schemaVersion !== undefined && version !== expected.schemaVersion) return failure('conflict', 'Unexpected Crossfire schema version');
      const integrity = selected.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok' || (selected.pragma('foreign_key_check') as unknown[]).length !== 0) return failure('native', 'Database integrity or foreign keys failed');
      const names = selected.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      const readers = counts(selected), totals: Record<string, number> = {};
      if (names.length !== Object.keys(readers).length) return failure('invalid', 'Database does not contain the complete current schema');
      for (const { name } of names) {
        if (!Object.hasOwn(readers, name)) return failure('invalid', 'Database has a table not recognized by this build');
        totals[name] = readers[name as keyof typeof readers]();
      }
      for (const [name, count] of Object.entries(expected.counts ?? {})) if (totals[name] !== count) return failure('conflict', 'Unexpected row count in ' + name);
      const metadata = includeSchema ? names.map(({ name }) => ({ name, columns: selected.pragma('table_info(' + name + ')'),
        foreignKeys: selected.pragma('foreign_key_list(' + name + ')'), indexes: selected.pragma('index_list(' + name + ')') })) : undefined;
      return success({ checkedAt: new Date().toISOString(), schemaVersion: version, integrity: 'ok', foreignKeys: 'ok', counts: totals,
        ...(metadata ? { schema: metadata } : {}) });
    })();
  } catch { return failure('invalid', 'Cannot safely inspect the selected database with this build'); }
  finally { database?.close(); }
}

export function verifyPreservation(before: string, after: string, retention?: RetentionProof) {
  const first = inspectDatabase(before, {}, false), second = inspectDatabase(after, {}, false);
  if (!first.ok) return first; if (!second.ok) return second;
  let original: Database.Database | undefined, current: Database.Database | undefined, converted: Database.Database | undefined;
  try {
    original = new Database(before, { readonly: true, fileMustExist: true });
    current = new Database(after, { readonly: true, fileMustExist: true });
    if (first.value.schemaVersion !== second.value.schemaVersion) {
      if (![13, 14, 15, 16].includes(Number(first.value.schemaVersion)) || second.value.schemaVersion !== SCHEMA_VERSION) return failure('invalid', 'No verified forward migration exists between these stores');
      converted = new Database(original.serialize());
      converted.pragma('foreign_keys = ON');
      createSchema(converted);
    }
    const firstDatabase = converted ?? original, secondDatabase = current;
    return firstDatabase.transaction(() => secondDatabase.transaction(() => {
      const proof = retentionProof(firstDatabase, retention); if (!proof.ok) return proof;
      const previous = protectedRecords(firstDatabase), next = protectedRecords(secondDatabase), preserved: Record<string, number> = {}, expired: Record<string, number> = {};
      for (const name of Object.keys(previous) as (keyof typeof previous)[]) {
        const existing = name === 'audit_event' && converted ? protectedRecords(original!).audit_event() : previous[name](), actual = next[name]();
        if (existing.length > 100000 || actual.length > 100000) return failure('limit', 'Protected-record verification exceeds its 100000-row per-relation bound');
        const identity = recordIdentity(firstDatabase, name), identities = new Set(actual.map(identity));
        const rowHash = (row: object) => createHash('sha256').update(JSON.stringify(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
        const available = new Map<string, number>();
        for (const row of actual) { const key = rowHash(row); available.set(key, (available.get(key) ?? 0) + 1); }
        for (const row of existing) {
          if (!identities.has(identity(row)) && proof.value.eligible(name, row)) { expired[name] = (expired[name] ?? 0) + 1; continue; }
          const key = rowHash(row), count = available.get(key) ?? 0;
          if (!count) return failure('conflict', 'Existing protected domain data changed or disappeared in ' + name);
          available.set(key, count - 1);
        }
        preserved[name] = existing.length - (expired[name] ?? 0);
      }
      if (converted) {
        const archived = (database: Database.Database) => executeSelect(database, schema, query => query.from('audit_event')
          .where(row => row.action === 'agent.name.canonicalized' && row.request_id === 'schema-15-agent-names')
          .select(row => ({ owner_id: row.owner_id, target_kind: row.target_kind, target_id: row.target_id, actor_kind: row.actor_kind,
            action: row.action, request_id: row.request_id, outcome: row.outcome, message: row.message })).take(100001));
        const expected = archived(converted), actual = archived(secondDatabase);
        if (expected.length > 100000 || actual.length > 100000) return failure('limit', 'Name-archive verification exceeds its finite record bound');
        const available = new Map<string, number>();
        for (const row of actual) { const key = JSON.stringify(row); available.set(key, (available.get(key) ?? 0) + 1); }
        for (const row of expected) {
          const key = JSON.stringify(row), count = available.get(key) ?? 0;
          if (!count) return failure('conflict', 'A retired independent agent label is missing from its immutable migration audit');
          available.set(key, count - 1);
        }
      }
      return success({ beforeSchema: first.value.schemaVersion, afterSchema: second.value.schemaVersion, forwardMigration: converted !== undefined, preserved,
        expired, loggingRetention: retention ?? null, beforeCounts: first.value.counts, afterCounts: second.value.counts });
    })())();
  } catch { return failure('invalid', 'Cannot inspect protected records using the current schema'); }
  finally { converted?.close(); original?.close(); current?.close(); }
}

function protectedRecords(database: Database.Database) {
  return {
    enrollment_request: () => executeSelect(database, schema, query => query.from('enrollment_request').take(100001)),
    enrollment_item: () => executeSelect(database, schema, query => query.from('enrollment_item').take(100001)),
    enrollment_controller_metadata: () => executeSelect(database, schema, query => query.from('enrollment_controller_metadata').take(100001)),
    enrollment_archive: () => executeSelect(database, schema, query => query.from('enrollment_archive').take(100001)),
    enrollment_archive_item: () => executeSelect(database, schema, query => query.from('enrollment_archive_item').take(100001)),
    enrollment_archive_policy: () => executeSelect(database, schema, query => query.from('enrollment_archive_policy').take(100001)),
    enrollment_archive_permission: () => executeSelect(database, schema, query => query.from('enrollment_archive_permission').take(100001)),
    enrollment_archive_wake_sender: () => executeSelect(database, schema, query => query.from('enrollment_archive_wake_sender').take(100001)),
    enrollment_archive_metadata: () => executeSelect(database, schema, query => query.from('enrollment_archive_metadata').take(100001)),
    fleet_native_stop: () => executeSelect(database, schema, query => query.from('fleet_native_stop').take(100001)),
    publication: () => executeSelect(database, schema, query => query.from('publication').take(100001)),
    publication_file: () => executeSelect(database, schema, query => query.from('publication_file').take(100001)),
    principal: () => executeSelect(database, schema, query => query.from('principal').take(100001)),
    member: () => executeSelect(database, schema, query => query.from('member').take(100001)),
    agent: () => executeSelect(database, schema, query => query.from('agent').take(100001)),
    agent_credential: () => executeSelect(database, schema, query => query.from('agent_credential').select(row => ({ agent_id: row.agent_id, provisioning_password: row.provisioning_password, access_token: row.access_token })).take(100001)),
    agent_name: () => executeSelect(database, schema, query => query.from('agent_name').take(100001)),
    instance_policy: () => executeSelect(database, schema, query => query.from('instance_policy').take(100001)),
    permission: () => executeSelect(database, schema, query => query.from('permission').take(100001)),
    role: () => executeSelect(database, schema, query => query.from('role').take(100001)),
    role_permission: () => executeSelect(database, schema, query => query.from('role_permission').take(100001)),
    principal_role: () => executeSelect(database, schema, query => query.from('principal_role').take(100001)),
    agent_wake_sender: () => executeSelect(database, schema, query => query.from('agent_wake_sender').take(100001)),
    enrollment_item_policy: () => executeSelect(database, schema, query => query.from('enrollment_item_policy').take(100001)),
    enrollment_item_permission: () => executeSelect(database, schema, query => query.from('enrollment_item_permission').take(100001)),
    enrollment_item_wake_sender: () => executeSelect(database, schema, query => query.from('enrollment_item_wake_sender').take(100001)),
    agent_room_grant: () => executeSelect(database, schema, query => query.from('agent_room_grant').take(100001)),
    agent_room_permission: () => executeSelect(database, schema, query => query.from('agent_room_permission').take(100001)),
    member_invitation: () => executeSelect(database, schema, query => query.from('member_invitation').take(100001)),
    agent_owner_conversation: () => executeSelect(database, schema, query => query.from('agent_owner_conversation').take(100001)),
    management_conversation: () => executeSelect(database, schema, query => query.from('management_conversation').take(100001)),
    wake_rule: () => executeSelect(database, schema, query => query.from('wake_rule').take(100001)),
    wake_rule_agent: () => executeSelect(database, schema, query => query.from('wake_rule_agent').select(row => ({ rule_id: row.rule_id, agent_id: row.agent_id })).take(100001)),
    fleet: () => executeSelect(database, schema, query => query.from('fleet').take(100001)),
    fleet_instance: () => executeSelect(database, schema, query => query.from('fleet_instance').take(100001)),
    fleet_instance_policy: () => executeSelect(database, schema, query => query.from('fleet_instance_policy').take(100001)),
    fleet_instance_permission: () => executeSelect(database, schema, query => query.from('fleet_instance_permission').take(100001)),
    fleet_credential: () => executeSelect(database, schema, query => query.from('fleet_credential').take(100001)),
    fleet_controller_metadata: () => executeSelect(database, schema, query => query.from('fleet_controller_metadata').take(100001)),
    audit_event: () => executeSelect(database, schema, query => query.from('audit_event').take(100001)),
  };
}
