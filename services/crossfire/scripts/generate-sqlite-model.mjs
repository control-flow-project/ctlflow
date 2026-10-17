import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';
import { databaseConfiguration } from '@ctlflow/crossfire-data/management/sqlite/configuration';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(join(root, 'database/management/sqlite/contract.json'), 'utf8'));
const output = join(root, 'csharp/packages/Crossfire.AdapterSqlite');
const check = process.argv.slice(2);
assert(check.length === 0 || check.length === 1 && check[0] === '--check', 'Use --check or no arguments');
const migrator = knex(databaseConfiguration(':memory:'));
await migrator.migrate.latest();
const pascal = value => value.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('');
const quote = value => JSON.stringify(value);
const nativeTypes = { TEXT: 'string', INTEGER: 'long', REAL: 'double', BLOB: 'byte[]' };

function emit(relative, lines) {
  const path = join(output, relative), content = lines.join('\n') + '\n';
  if (check.length) assert.equal(readFileSync(path, 'utf8'), content, relative + ' differs from the canonical SQLite schema');
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
}

try {
  const names = await migrator('sqlite_schema').select('name').where('type', 'table')
    .where('name', 'not like', 'sqlite_%').where('name', 'not like', 'knex_%').orderBy('rowid');
  const tables = await Promise.all(names.map(async ({ name }) => ({ name,
    columns: await migrator('pragma_table_info').where('arg', name).select('*'),
    foreignKeys: await migrator('pragma_foreign_key_list').where('arg', name).select('*') })));
  for (const table of tables) {
    const properties = table.columns.map(column => {
      const required = Boolean(column.notnull || column.pk), type = nativeTypes[column.type];
      assert(type, 'Unsupported SQLite storage carrier: ' + column.type);
      return '    public ' + type + (required ? '' : '?') + ' ' + pascal(column.name) + ' { get; set; }'
        + (required && column.type === 'TEXT' ? ' = "";' : required && column.type === 'BLOB' ? ' = [];' : '');
    });
    emit('Entities/' + pascal(table.name) + 'Row.cs', ['namespace Crossfire.AdapterSqlite.Entities;', '', 'public class ' + pascal(table.name) + 'Row', '{', ...properties, '}']);
  }
  const imports = ['using Microsoft.EntityFrameworkCore;', 'using Crossfire.AdapterSqlite.Entities;', '', 'namespace Crossfire.AdapterSqlite;', '', 'public sealed partial class CrossfireDbContext', '{'];
  for (let offset = 0; offset < tables.length; offset += 10) {
    const batch = offset / 10, body = [];
    for (const table of tables.slice(offset, offset + 10)) {
      const keys = table.columns.filter(column => column.pk).sort((left, right) => left.pk - right.pk).map(column => 'value.' + pascal(column.name));
      assert(keys.length, 'Every managed entity requires a canonical key');
      body.push('        model.Entity<' + pascal(table.name) + 'Row>(entity =>', '        {', '            entity.ToTable(' + quote(table.name) + ');',
        '            entity.HasKey(value => ' + (keys.length === 1 ? keys[0] : 'new { ' + keys.join(', ') + ' }') + ');');
      for (const column of table.columns) body.push('            entity.Property(value => value.' + pascal(column.name) + ').HasColumnName(' + quote(column.name)
        + ').HasColumnType(' + quote(column.type) + ').ValueGeneratedNever()' + (column.notnull || column.pk ? '.IsRequired()' : '') + ';');
      body.push('        });');
    }
    emit('Tables' + batch + '.g.cs', [...imports, '    private static void ConfigureTables' + batch + '(ModelBuilder model)', '    {', ...body, '    }', '}']);
  }
  const foreignKeys = [];
  for (const table of tables) {
    const groups = Map.groupBy(table.foreignKeys, key => key.id);
    for (const keys of groups.values()) {
      keys.sort((left, right) => left.seq - right.seq);
      assert(keys.every(key => key.on_delete === keys[0].on_delete), 'Composite foreign-key deletion semantics differ');
      const deletion = { 'NO ACTION': 'NoAction', CASCADE: 'Cascade' }[keys[0].on_delete];
      assert(deletion, 'Unsupported canonical deletion semantics');
      foreignKeys.push('        model.Entity<' + pascal(table.name) + 'Row>().HasOne<' + pascal(keys[0].table) + 'Row>().WithMany()',
        '            .HasForeignKey(' + keys.map(key => quote(pascal(key.from))).join(', ') + ')',
        '            .HasPrincipalKey(' + keys.map(key => quote(pascal(key.to))).join(', ') + ').OnDelete(DeleteBehavior.' + deletion + ');');
    }
  }
  emit('ForeignKeys.g.cs', [...imports, '    private static void ConfigureForeignKeys(ModelBuilder model)', '    {', ...foreignKeys, '    }', '}']);
  emit('SchemaContract.g.cs', ['namespace Crossfire.AdapterSqlite;', '', 'public static class SchemaContract', '{',
    '    public const long ApplicationId = ' + contract.application + ';', '    public const long Version = ' + contract.version + ';',
    '    public static readonly string[] Migrations = [' + contract.migrations.map(quote).join(', ') + '];', '}']);
  console.log(JSON.stringify({ tables: tables.length, relationships: foreignKeys.length / 3, mode: check.length ? 'check' : 'generate' }));
} finally { await migrator.destroy(); }
