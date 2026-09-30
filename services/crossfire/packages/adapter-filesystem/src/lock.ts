import { openSync, closeSync, fstatSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDir } from './index.js';

export function acquireFileLock(path: string): () => void {
  if (process.platform !== 'linux') throw new Error('Private process locks require Linux flock');
  privateDir(dirname(path));
  const descriptor = openSync(path + '.lock', constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077) throw new Error('Lock must be a private owned regular file');
    try { execFileSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], { stdio: ['ignore', 'pipe', 'pipe', descriptor] }); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 75) throw new Error('Native flock is required for private process ownership');
      throw Object.assign(new Error('Another process already owns this private state'), { code: 'ELOCKED' });
    }
    let released = false;
    return () => { if (!released) { released = true; closeSync(descriptor); } };
  } catch (error) { closeSync(descriptor); throw error; }
}

export async function acquireProcessLock(path: string, retries = 0): Promise<() => Promise<void>> {
  for (let attempt = 0; ; attempt++) {
    try { const release = acquireFileLock(path); return async () => release(); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ELOCKED') || attempt >= retries) throw error;
      await delay(1000);
    }
  }
}
