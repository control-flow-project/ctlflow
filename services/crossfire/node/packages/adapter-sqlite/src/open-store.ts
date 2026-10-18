import Database from 'better-sqlite3';
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateSchema } from './schema/validate-schema.js';

export function openStore(path: string): Database.Database {
  if (path !== ':memory:') {
    const directory = dirname(resolve(path)), information = lstatSync(directory);
    if (!information.isDirectory() || information.uid !== process.getuid!() || information.mode & 0o077
      || realpathSync(directory) !== directory) throw new Error('Management storage must be a private owned non-symlink directory');
    const descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0) throw new Error('Management storage must be a private, owned regular file');
    } finally { closeSync(descriptor); }
  }
  const database = new Database(path, { fileMustExist: path !== ':memory:' });
  try {
    validateSchema(database);
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    return database;
  } catch (error) { database.close(); throw error; }
}
