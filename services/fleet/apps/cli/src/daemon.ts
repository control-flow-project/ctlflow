import { spawn } from 'node:child_process';
import { openSync, closeSync, constants, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDir } from '@crossfire/adapter-filesystem/index';
import { createDaemonClient, operations } from '@fleet/daemon-client/client';

export async function launchDaemon(root: string, name: string, signal: AbortSignal) {
  privateDir(root);
  const client = createDaemonClient(join(root, 'fleetd.sock'), signal);
  const existing = await client.call(operations.status, {}, {});
  if (existing.ok) throw new Error('A fleet daemon is already running at this root');
  const output = openSync(join(root, 'daemon.log'), constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  const info = fstatSync(output);
  if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077) { closeSync(output); throw new Error('Daemon log is not a private owned file'); }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('@fleetd/service/executable')), '--root', root, '--name', name], { detached: true, stdio: ['ignore', output, output] });
  closeSync(output); child.unref();
  const ended = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  let failed = false;
  child.once('error', () => { failed = true; }); child.once('exit', () => { failed = true; });
  const deadline = Date.now() + 15000;
  try {
    for (;;) {
      signal.throwIfAborted();
      const status = await client.call(operations.status, {}, {});
      if (status.ok && status.value.data.controller.name === name) return status.value.data;
      if (status.ok || failed || Date.now() > deadline) throw new Error('Daemon did not start with the requested identity; inspect ' + join(root, 'daemon.log'));
      await delay(100, undefined, { signal });
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await ended; } finally { clearTimeout(timer); }
    throw error;
  }
}
