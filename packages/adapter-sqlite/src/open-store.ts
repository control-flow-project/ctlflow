import Database from 'better-sqlite3';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { privateDir } from '../../files/src/index.js';
import { createSchema } from './schema/create-schema.js';

export function openStore(path: string): Database.Database {
  if (path !== ':memory:') {
    privateDir(dirname(path));
    const descriptor = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0) throw new Error('Management storage must be a private, owned regular file');
    } finally { closeSync(descriptor); }
  }
  const database = new Database(path);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('journal_mode = DELETE');
    const pageSize = database.pragma('page_size', { simple: true });
    if (typeof pageSize !== 'number' || pageSize < 512 || pageSize > 65536) throw new Error('Invalid SQLite page size');
    database.pragma('max_page_count = ' + Math.floor(256 * 1024 * 1024 / pageSize));
    createSchema(database);
    return database;
  } catch (error) { database.close(); throw error; }
}
