import knex, { type Knex } from 'knex';
import type Database from 'better-sqlite3';

export const migrationQuery = knex({ client: 'better-sqlite3', useNullAsDefault: true, compileSqlOnError: false });

export function migrationRows(database: Database.Database, query: Knex.QueryBuilder): Record<string, unknown>[] {
  const compiled = query.toSQL();
  return database.prepare<unknown[], Record<string, unknown>>(compiled.sql).all(...compiled.bindings);
}

export function migrationChange(database: Database.Database, query: Knex.QueryBuilder | Knex.SchemaBuilder): void {
  const statements = query.toSQL();
  for (const statement of Array.isArray(statements) ? statements : [statements])
    database.prepare<unknown[]>(statement.sql).run(...statement.bindings);
}

export function migrationSnapshot(database: Database.Database): Map<string, Record<string, unknown>[]> {
  const tables = migrationRows(database, migrationQuery('sqlite_schema').select('name').where('type', 'table')
    .where('name', 'not like', 'sqlite_%').whereNotIn('name', ['knex_migrations', 'knex_migrations_lock']).orderBy('name'));
  return new Map(tables.map(row => {
    if (typeof row.name !== 'string') throw new Error('Invalid migration table metadata');
    return [row.name, migrationRows(database, migrationQuery(row.name).select('*').orderBy('rowid'))];
  }));
}

export function migrationCatalog(database: Database.Database): Record<string, unknown>[] {
  return migrationRows(database, migrationQuery('sqlite_schema').select('*').orderBy('name'));
}
