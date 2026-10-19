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

export function databaseConfiguration(filename) {
  prepareFile(filename);
  return {
    client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true, compileSqlOnError: false,
    migrations: { directory: fileURLToPath(new URL('./migrations/', import.meta.url)), loadExtensions: ['.mjs'] },
    seeds: { directory: fileURLToPath(new URL('./seeds/', import.meta.url)), loadExtensions: ['.mjs'] },
    pool: { min: 0, max: 1, afterCreate(connection, done) {
      try {
        connection.pragma('foreign_keys=ON');
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
