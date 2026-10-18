import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const metadata = knex({ client: 'better-sqlite3', useNullAsDefault: true, compileSqlOnError: false });

function rows(connection, query) {
  const compiled = query.toSQL();
  return connection.prepare(compiled.sql).all(...compiled.bindings);
}

function prepareFile(filename) {
  if (filename === ':memory:') return;
  if (!isAbsolute(filename)) throw new Error('Database migration path must be absolute');
  const directory = dirname(filename);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const information = lstatSync(directory);
  if (!information.isDirectory() || information.uid !== process.getuid()
    || information.mode & 0o077 || realpathSync(directory) !== resolve(directory))
    throw new Error('Migration storage must be a private owned non-symlink directory');
  const descriptor = openSync(filename, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const file = fstatSync(descriptor);
    if (!file.isFile() || file.uid !== process.getuid() || file.mode & 0o077)
      throw new Error('Management storage must be a private, owned regular file');
  } finally { closeSync(descriptor); }
}

export function admitDatabase(connection) {
  const application = rows(connection, metadata('pragma_application_id').select('application_id'))[0].application_id;
  const version = rows(connection, metadata('pragma_user_version').select('user_version'))[0].user_version;
  const tables = rows(connection, metadata('sqlite_schema').select('name').where('type', 'table').where('name', 'not like', 'sqlite_%'));
  if (application === 0 && version === 0 && tables.every(table => ['knex_migrations', 'knex_migrations_lock'].includes(table.name))) {
    if (!tables.some(table => table.name === 'knex_migrations')
      || rows(connection, metadata('knex_migrations').count({ count: '*' }))[0].count === 0) return;
  }
  if (application !== 1129465426 || ![13, 14, 15, 16, 17, 18].includes(version))
    throw new Error('Unsupported Crossfire schema; only deployed schemas 13 through 18 can advance through Knex. No data was changed');
  const checks = rows(connection, metadata('pragma_integrity_check').select('integrity_check'));
  if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || rows(connection, metadata('pragma_foreign_key_check').select('*')).length)
    throw new Error('Database integrity or preserved relationships failed; no data was changed');
}

export function databaseConfiguration(filename) {
  prepareFile(filename);
  return {
    client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true, compileSqlOnError: false,
    migrations: { directory: fileURLToPath(new URL('./migrations/', import.meta.url)), loadExtensions: ['.mjs'] },
    seeds: { directory: fileURLToPath(new URL('./seeds/', import.meta.url)), loadExtensions: ['.mjs'] },
    pool: { min: 0, max: 1, afterCreate(connection, done) {
      try {
        admitDatabase(connection);
        connection.pragma('foreign_keys=OFF');
        connection.pragma('busy_timeout=5000');
        connection.pragma('journal_mode=WAL');
        connection.pragma('synchronous=FULL');
        done(null, connection);
      } catch (error) { connection.close(); done(error); }
    } },
  };
}

export async function migrateDatabase(filename) {
  const migrator = knex(databaseConfiguration(filename));
  try { await migrator.migrate.latest(); }
  finally { await migrator.destroy(); }
}
