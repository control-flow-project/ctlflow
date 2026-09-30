import { openSync, closeSync, fstatSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDir } from './index.js';

export async function acquireProcessLock(path: string, retries = 0): Promise<() => Promise<void>> {
  privateDir(dirname(path));
  const descriptor = openSync(path + '.lock', constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  let database: DatabaseSync | undefined;
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077) throw new Error('Lock must be a private owned regular file');
    database = new DatabaseSync(path + '.lock', { timeout: 0 });
    for (let attempt = 0; ; attempt++) {
      try { database.exec('BEGIN EXCLUSIVE'); break; }
      catch (error) {
        if (!error || typeof error !== 'object' || !('errcode' in error) || ![5, 6].includes(Number(error.errcode))) throw error;
        if (attempt >= retries) throw Object.assign(new Error('Another process already owns this private state'), { code: 'ELOCKED' });
        await delay(1000);
      }
    }
    let released = false;
    return async () => { if (!released) { released = true; database?.close(); closeSync(descriptor); } };
  } catch (error) { database?.close(); closeSync(descriptor); throw error; }
}
