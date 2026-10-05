#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { existsSync, lstatSync, unlinkSync, chmodSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { controller as parseController } from '@ctlflow/crossfire-contracts/schema/controller';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { createController } from '@ctlflow/fleetd-domain/controller';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { createExecution } from './execution.js';
import { createDaemonHttp } from './http.js';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';

export async function startDaemon(root: string, name: string) {
  if (process.platform !== 'linux') throw new Error('Fleet controller requires Linux');
  let parsed = parseController({ name });
  if (!parsed.ok) throw new Error(parsed.error.message);
  privateDir(root);
  const unlock = await acquireProcessLock(join(root, 'daemon'));
  let cleanup = unlock;
  try {
    const file = join(root, 'controller.json');
    if (existsSync(file)) {
      const existing = parseController(readJson<unknown>(file));
      if (!existing.ok || existing.value.name !== name) throw new Error('Controller root is already named differently');
      parsed = existing;
    } else writeJson(file, parsed.value);
    const socketPath = join(root, 'fleetd.sock');
    if (Buffer.byteLength(socketPath) > 100) throw new Error('Controller root is too long for a Unix socket; choose a shorter directory');
    if (existsSync(socketPath)) {
      const information = lstatSync(socketPath);
      if (!information.isSocket() || information.uid !== process.getuid!()) throw new Error('Refusing an unowned or non-socket controller endpoint');
      const live = await new Promise<boolean>((resolve, reject) => {
        const socket = createConnection(socketPath); socket.setTimeout(2000);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('Existing controller did not respond')); });
        socket.once('error', error => { if ('code' in error && error.code === 'ECONNREFUSED') resolve(false); else reject(error); });
      });
      if (live) throw new Error('Controller is already running');
      const current = lstatSync(socketPath);
      if (current.ino !== information.ino || current.dev !== information.dev) throw new Error('Controller socket changed during startup');
      unlinkSync(socketPath);
    }
    const created = createController({ registry: createRegistry(root), execution: createExecution({ codex: codexRuntime() }), controller: parsed.value, id: randomUUID, now: Date.now, delay: nativeClock.delay });
    if (!created.ok) throw new Error(created.error.message);
    const controller = created.value;
    let closing: Promise<void> | undefined;
    const server = createDaemonHttp(controller, () => { void close(); });
    const close = () => closing ??= (async () => {
      try { await controller.close(); }
      finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await unlock();
      }
    })();
    cleanup = close;
    await controller.ready();
    server.listen(socketPath); await once(server, 'listening'); chmodSync(socketPath, 0o600);
    return { controller, close, socketPath };
  } catch (error) { await cleanup(); throw error; }
}
const invoked = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, name: { type: 'string' } } });
  if (!values.root || !values.name) throw new Error('fleetd --root ABSOLUTE_DIRECTORY --name NAME');
  const daemon = await startDaemon(resolve(values.root), values.name);
  console.log(JSON.stringify({ status: 'ready', controller: daemon.controller.status().controller, socket: daemon.socketPath }));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => { void daemon.close(); });
}
