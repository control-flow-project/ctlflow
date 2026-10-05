import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';

test('native process locks survive suspension, release on owner death, and retain one inode', async scope => {
  const path = join(mkdtempSync(join(tmpdir(), 'crossfire-lock-')), 'receiver');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./support/lock-owner.js', import.meta.url)), path], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ended = once(child, 'close');
  cleanup(scope, async () => { child.kill('SIGKILL'); await ended; });
  await once(child, 'message');
  const inode = statSync(path + '.lock').ino;
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  child.kill('SIGSTOP');
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  child.kill('SIGKILL'); await ended;
  const release = await acquireProcessLock(path);
  assert.equal(statSync(path + '.lock').ino, inode);
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  await release(); await release();
  await (await acquireProcessLock(path))();
});
