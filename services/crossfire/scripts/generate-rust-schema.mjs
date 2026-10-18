import knex from 'knex';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import schema from '@ctlflow/crossfire-data/management/sqlite/contract' with { type: 'json' };

const root = new URL('../', import.meta.url);
const output = new URL('rust/packages/adapter-sqlite/src/tables/', root);
const argumentsList = process.argv.slice(2);
const databaseIndex = argumentsList.indexOf('--database');
if (databaseIndex < 0 || !argumentsList[databaseIndex + 1] || argumentsList.some((value, position) =>
  value !== '--check' && value !== '--database' && position !== databaseIndex + 1)) {
  throw new Error('Use --database /absolute/path/to/Knex-prepared.sqlite and optional --check');
}
const databasePath = argumentsList[databaseIndex + 1];
if (!databasePath.startsWith('/')) throw new Error('Use an absolute Knex-prepared database path');
const database = knex({ client: 'better-sqlite3', connection: { filename: databasePath, options: { readonly: true } },
  useNullAsDefault: true, compileSqlOnError: false, pool: { min: 0, max: 1 } });
const groups = new Map(['identity', 'agents', 'enrollment', 'fleets', 'activity', 'publications', 'wake'].map(name => [name, []]));
const groupFor = name => {
  if (/^(principal|member|role|permission|instance_policy)/u.test(name)) return 'identity';
  if (/^(agent|room_grant)/u.test(name)) return 'agents';
  if (/^enrollment/u.test(name)) return 'enrollment';
  if (/^fleet/u.test(name)) return 'fleets';
  if (/^(audit|listener|runtime|management_conversation|incident_notification)/u.test(name)) return 'activity';
  if (/^publication/u.test(name)) return 'publications';
  if (/^wake/u.test(name)) return 'wake';
  throw new Error('Canonical table has no semantic Rust schema owner');
};
const publish = (name, text) => {
  const formatted = spawnSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], { input: text, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (formatted.status !== 0) throw new Error('Cannot format the generated Rust schema');
  const destination = new URL(`${name}.rs`, output);
  if (process.argv.includes('--check')) {
    if (readFileSync(destination, 'utf8') !== formatted.stdout) throw new Error('Rust canonical schema mapping has drifted');
  } else {
    mkdirSync(output, { recursive: true });
    writeFileSync(destination, formatted.stdout);
  }
};
try {
  const application = (await database('pragma_application_id').first()).application_id;
  const version = (await database('pragma_user_version').first()).user_version;
  if (application !== schema.application || version !== schema.version) throw new Error('Invalid Crossfire database schema identity');
  const tables = await database('sqlite_schema').select('name').where('type', 'table').where('name', 'not like', 'sqlite_%')
    .whereNotIn('name', ['knex_migrations', 'knex_migrations_lock']).orderBy('name');
  const migrations = (await database('knex_migrations').select('name').orderBy('name')).map(row => row.name);
  if (!migrations.length) throw new Error('Database has no completed Knex migrations');
  const declarations = await Promise.all(tables.map(async ({ name }) => {
    if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error('Invalid canonical table name');
    const columns = await database('pragma_table_info').where('arg', name).select('*');
    const keys = columns.filter(column => column.pk).sort((left, right) => left.pk - right.pk).map(column => column.name);
    if (!keys.length) throw new Error('Canonical table requires an explicit identity');
    const fields = columns.map(column => {
      const base = { INTEGER: 'BigInt', TEXT: 'Text', REAL: 'Double', BLOB: 'Binary' }[column.type];
      if (!base || !/^[a-z][a-z0-9_]*$/u.test(column.name)) throw new Error('Unsupported canonical column');
      const type = column.notnull || column.pk ? base : `Nullable<${base}>`;
      return `        ${column.name} -> ${type},`;
    });
    groups.get(groupFor(name)).push(name);
    return { name, contents: `diesel::table! {\n    ${name} (${keys.join(', ')}) {\n${fields.join('\n')}\n    }\n}\n` };
  }));
  for (const [group, names] of groups) {
    publish(group, declarations.filter(item => names.includes(item.name)).map(item => item.contents).join('\n'));
  }
  publish('mod', `pub const APPLICATION_ID: i64 = ${application};\npub const SCHEMA_VERSION: i64 = ${version};\npub const MIGRATIONS: &[&str] = &[${migrations.map(value => JSON.stringify(value)).join(',')}];\n\n` + [...groups].map(([name, tables]) => `mod ${name};\npub use ${name}::{${tables.join(',')}};`).join('\n') + '\ndiesel::allow_tables_to_appear_in_same_query!(\n' + tables.map(table => `    ${table.name},`).join('\n') + '\n);\n');
  process.stdout.write(JSON.stringify({ tables: tables.length, file: fileURLToPath(output), mode: process.argv.includes('--check') ? 'check' : 'generate' }) + '\n');
} finally { await database.destroy(); }
