import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { executeInsert, executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { createSchema } from '@tinqerjs/tinqer';
import { schema } from './tables.js';
import { migrateEnrollmentItems } from './enrollment-migration.js';

const priorNames = createSchema<{ agent: { principal_id: string; owner_id: string; display_name_override: string | null } }>();

export function archiveAgentLabels(database: Database.Database): void {
  const labels = executeSelect(database, priorNames, query => query.from('agent').where(row => row.display_name_override !== null));
  const now = Date.now();
  for (const label of labels) executeInsert(database, schema, (query, params) => query.insertInto('audit_event').values({
    id: params.id, request_id: 'schema-15-agent-names', actor_kind: 'system', owner_id: params.owner_id,
    target_kind: 'agent', target_id: params.principal_id, action: 'agent.name.canonicalized', outcome: 'applied',
    message: params.message, created_at: params.now }),
  { ...label, id: randomUUID(), now, message: JSON.stringify({ retiredDisplayName: label.display_name_override }) });
}

export function migrateAgentNames(database: Database.Database): void {
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys = OFF');
  try { database.transaction(() => {
    archiveAgentLabels(database);
    database.exec('ALTER TABLE agent DROP COLUMN display_name_override');
    migrateEnrollmentItems(database);
    database.exec("UPDATE principal_application SET applied_intent_hash=NULL,next_check_at=0 WHERE principal_id IN (SELECT principal_id FROM agent)");
    const violations = database.pragma('foreign_key_check');
    if (!Array.isArray(violations) || violations.length) throw new Error('Name migration would violate preserved identity history');
    database.pragma('user_version = 15');
  }).immediate(); } finally { database.pragma('foreign_keys = ' + (foreignKeys === 1 ? 'ON' : 'OFF')); }
}
