import { openSync, closeSync, fstatSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDir } from './index.js';

export function acquireFileLock(path: string): () => void {
  privateDir(dirname(path));
  const descriptor = openSync(path + '.lock', constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  let database: DatabaseSync | undefined;
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077) throw new Error('Lock must be a private owned regular file');
    database = new DatabaseSync(path + '.lock', { timeout: 0 });
    try {
      if (database.prepare('PRAGMA journal_mode = MEMORY').get()?.journal_mode !== 'memory') throw new Error('Private lock requires an in-memory rollback journal');
      database.exec('BEGIN EXCLUSIVE');
    }
    catch (error) {
      if (!error || typeof error !== 'object' || !('errcode' in error) || ![5, 6].includes(Number(error.errcode))) throw error;
      throw Object.assign(new Error('Another process already owns this private state'), { code: 'ELOCKED' });
    }
    let released = false;
    return () => { if (!released) { released = true; database?.close(); closeSync(descriptor); } };
  } catch (error) { database?.close(); closeSync(descriptor); throw error; }
}

export async function acquireProcessLock(path: string, retries = 0, intervalMs = 1000): Promise<() => Promise<void>> {
  if (!Number.isInteger(retries) || retries < 0 || !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1000) throw new Error('Private lock observation requires bounded retries and intervals');
  for (let attempt = 0; ; attempt++) {
    try { const release = acquireFileLock(path); return async () => release(); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ELOCKED') || attempt >= retries) throw error;
      await delay(intervalMs);
    }
  }
}
