import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareControllerRoot } from '@ctlflow/fleetd-storage/controller-root';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { existsSync } from 'node:fs';

export async function launchDaemon(root: string, name: string | undefined, signal: AbortSignal) {
  prepareControllerRoot(root);
  const unlock = await acquireProcessLock(join(root, 'launcher'), 65);
  try { return await launch(root, name, signal); }
  finally { await unlock(); }
}
export async function restartDaemon(root: string, signal: AbortSignal) {
  const client = createDaemonClient(join(root, 'fleetd.sock'), signal);
  const previous = await client.call(operations.status, {}, {});
  if (!previous.ok) throw new Error(previous.error.message + '; use daemon start if the controller is not running');
  const stopped = await client.call(operations.operate, {}, { operationId: randomUUID(), action: 'stop', target: { kind: 'daemon' }, expectedRevision: 0 });
  if (!stopped.ok) throw new Error(stopped.error.message + '; inspect controller status before retrying');
  const deadline = Date.now() + 65000;
  for (;;) {
    signal.throwIfAborted();
    const current = await client.call(operations.status, {}, {});
    if (!current.ok) {
      if (current.error.code !== 'unavailable') throw new Error(current.error.message);
      break;
    }
    if (Date.now() >= deadline) throw new Error('Controller shutdown exceeded its deadline; inspect the saved root before retrying');
    await delay(100, undefined, { signal });
  }
  return launchDaemon(root, previous.value.data.controller.name, signal);
}
async function launch(root: string, name: string | undefined, signal: AbortSignal) {
  const client = createDaemonClient(join(root, 'fleetd.sock'), signal);
  const existing = existsSync(join(root, 'fleetd.sock')) ? await client.call(operations.status, {}, {})
    : { ok: false as const, error: { code: 'unavailable' as const, message: 'Controller has not started' } };
  if (existing.ok) {
    if (name !== undefined && existing.value.data.controller.name !== name || existing.value.data.stopping) throw new Error('The selected controller has another identity or is stopping');
    return existing.value.data;
  }
  if (existing.error.code !== 'unavailable') throw new Error('Existing controller response is invalid: ' + existing.error.message);
  signal.throwIfAborted();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('@ctlflow/fleetd/executable')), '--root', root, ...(name === undefined ? [] : ['--name', name])], { detached: true, stdio: 'ignore' });
  child.unref();
  const ended = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  let failed = false;
  child.once('error', () => { failed = true; }); child.once('exit', () => { failed = true; });
  const deadline = Date.now() + 65000;
  try {
    for (;;) {
      signal.throwIfAborted();
      const status = await client.call(operations.status, {}, {});
      if (status.ok && (name === undefined || status.value.data.controller.name === name) && !status.value.data.stopping) return status.value.data;
      if (status.ok || failed || Date.now() > deadline) throw new Error('Daemon did not start with the requested identity; inspect ' + join(root, 'logs'));
      await delay(100, undefined, { signal });
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await ended; } finally { clearTimeout(timer); }
    throw error;
  }
}
