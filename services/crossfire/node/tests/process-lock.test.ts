import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';

test('native process locks survive suspension, release on owner death, and retain one inode', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-lock-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'receiver');
  for (const [retries, interval] of [[-1, 25], [1.5, 25], [1, 0], [1, 1001], [1, Number.NaN]]) {
    await assert.rejects(acquireProcessLock(path, retries, interval), /bounded retries and intervals/u);
    assert.deepEqual(readdirSync(directory), [], 'Invalid observation settings cannot create lock state');
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./support/lock-owner.js', import.meta.url)), path], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ended = once(child, 'close');
  cleanup(scope, async () => { child.kill('SIGKILL'); await ended; });
  await once(child, 'message');
  assert.deepEqual(readdirSync(directory), ['receiver.lock']);
  const inode = statSync(path + '.lock').ino;
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  const cancelled = new AbortController();
  const pending = acquireProcessLock(path, 650, 100, cancelled.signal);
  cancelled.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(acquireProcessLock(join(directory, 'cancelled'), 650, 100, cancelled.signal), { name: 'AbortError' });
  assert.deepEqual(readdirSync(directory), ['receiver.lock'], 'Cancelled admission cannot create or replace ownership');
  child.kill('SIGSTOP');
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  child.kill('SIGKILL'); await ended;
  const release = await acquireProcessLock(path);
  assert.deepEqual(readdirSync(directory), ['receiver.lock']);
  assert.equal(statSync(path + '.lock').ino, inode);
  await assert.rejects(acquireProcessLock(path), { code: 'ELOCKED' });
  await release(); await release();
  await (await acquireProcessLock(path))();
});
