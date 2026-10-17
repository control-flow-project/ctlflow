import type Database from 'better-sqlite3';
import { createSchema } from '@tinqerjs/tinqer';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';

export type MetadataTables = {
  sqlite_schema: { type: string; name: string; tbl_name: string; rootpage: number; sql: string | null };
  knex_migrations: { id: number; name: string; batch: number; migration_time: number };
  pragma_application_id: { application_id: number };
  pragma_user_version: { user_version: number };
  pragma_journal_mode: { journal_mode: string };
  pragma_foreign_keys: { foreign_keys: number };
  pragma_page_size: { page_size: number };
  pragma_max_page_count: { max_page_count: number };
  pragma_synchronous: { synchronous: number };
  pragma_freelist_count: { freelist_count: number };
  pragma_page_count: { page_count: number };
  pragma_integrity_check: { integrity_check: string };
  pragma_foreign_key_check: { table: string; rowid: number | null; parent: string; fkid: number };
  pragma_table_info: { arg: string; cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
  pragma_foreign_key_list: { arg: string; id: number; seq: number; table: string; from: string; to: string; on_update: string; on_delete: string; match: string };
  pragma_index_list: { arg: string; seq: number; name: string; unique: number; origin: string; partial: number };
};

export const metadataSchema = createSchema<MetadataTables>();

function metadataValue<Value>(rows: readonly { value: Value }[]): Value {
  if (rows.length !== 1) throw new Error('Invalid management database metadata cardinality');
  return rows[0]!.value;
}

export function foreignKeyViolations(database: Database.Database) {
  return executeSelect(database, metadataSchema, query => query.from('pragma_foreign_key_check')
    .select(row => ({ table: row.table, rowid: row.rowid, parent: row.parent, fkid: row.fkid })));
}

export function integrityResult(database: Database.Database): string {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_integrity_check').select(row => ({ value: row.integrity_check }))));
}

export function integrityResults(database: Database.Database) {
  return executeSelect(database, metadataSchema, query => query.from('pragma_integrity_check').select(row => ({ integrity_check: row.integrity_check })));
}

export function foreignKeys(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_foreign_keys').select(row => ({ value: row.foreign_keys }))));
}

export function journalMode(database: Database.Database): string {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_journal_mode').select(row => ({ value: row.journal_mode }))));
}

export function pageSize(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_page_size').select(row => ({ value: row.page_size }))));
}

export function maximumPageCount(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_max_page_count').select(row => ({ value: row.max_page_count }))));
}

export function synchronousMode(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_synchronous').select(row => ({ value: row.synchronous }))));
}

export function freePageCount(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_freelist_count').select(row => ({ value: row.freelist_count }))));
}

export function pageCount(database: Database.Database): number {
  return metadataValue(executeSelect(database, metadataSchema, query => query.from('pragma_page_count').select(row => ({ value: row.page_count }))));
}

export function databaseIdentity(database: Database.Database): { application: number; version: number } {
  const applications = executeSelect(database, metadataSchema, query => query.from('pragma_application_id').select(row => ({ value: row.application_id })));
  const versions = executeSelect(database, metadataSchema, query => query.from('pragma_user_version').select(row => ({ value: row.user_version })));
  if (applications.length !== 1 || versions.length !== 1) throw new Error('Invalid management database identity metadata');
  return { application: applications[0]!.value, version: versions[0]!.value };
}

export function databaseValid(database: Database.Database): boolean {
  const checks = executeSelect(database, metadataSchema, query => query.from('pragma_integrity_check').select(row => ({ value: row.integrity_check })));
  return checks.length === 1 && checks[0]!.value === 'ok'
    && !executeSelect(database, metadataSchema, query => query.from('pragma_foreign_key_check').any());
}

export function appliedMigrations(database: Database.Database): string[] {
  return executeSelect(database, metadataSchema, query => query.from('knex_migrations').orderBy(row => row.name)
    .select(row => ({ name: row.name }))).map(row => row.name);
}

export function hasMigrationTable(database: Database.Database): boolean {
  return executeSelect(database, metadataSchema, query => query.from('sqlite_schema')
    .where(row => row.type === 'table' && row.name === 'knex_migrations').any());
}

export function databaseTables(database: Database.Database) {
  return executeSelect(database, metadataSchema, query => query.from('sqlite_schema')
    .where(row => row.type === 'table' && !row.name.startsWith('sqlite_') && row.name !== 'knex_migrations' && row.name !== 'knex_migrations_lock')
    .orderBy(row => row.name).select(row => ({ name: row.name })));
}

export function tableColumns(database: Database.Database, name: string) {
  return executeSelect(database, metadataSchema, (query, params) => query.from('pragma_table_info').where(row => row.arg === params.name)
    .select(row => ({ cid: row.cid, name: row.name, type: row.type, notnull: row.notnull, dflt_value: row.dflt_value, pk: row.pk })), { name });
}

export function tableMetadata(database: Database.Database, name: string) {
  return {
    name,
    columns: tableColumns(database, name),
    foreignKeys: executeSelect(database, metadataSchema, (query, params) => query.from('pragma_foreign_key_list').where(row => row.arg === params.name)
      .select(row => ({ id: row.id, seq: row.seq, table: row.table, from: row.from, to: row.to, on_update: row.on_update, on_delete: row.on_delete, match: row.match })), { name }),
    indexes: executeSelect(database, metadataSchema, (query, params) => query.from('pragma_index_list').where(row => row.arg === params.name)
      .select(row => ({ seq: row.seq, name: row.name, unique: row.unique, origin: row.origin, partial: row.partial })), { name }),
  };
}
