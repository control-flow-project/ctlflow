import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

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
  const application = connection.pragma('application_id', { simple: true });
  const version = connection.pragma('user_version', { simple: true });
  const tables = connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (application === 0 && version === 0 && tables.every(table => ['knex_migrations', 'knex_migrations_lock'].includes(table.name))) {
    if (!tables.some(table => table.name === 'knex_migrations')
      || connection.prepare('SELECT COUNT(*) AS count FROM knex_migrations').get().count === 0) return;
  }
  if (application !== 1129465426 || ![13, 14, 15, 16, 17].includes(version))
    throw new Error('Unsupported Crossfire schema; only deployed schemas 13, 14, 15, 16 and 17 can advance through Knex. No data was changed');
  if (connection.pragma('integrity_check', { simple: true }) !== 'ok' || connection.pragma('foreign_key_check').length)
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
        connection.pragma('journal_mode=DELETE');
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
