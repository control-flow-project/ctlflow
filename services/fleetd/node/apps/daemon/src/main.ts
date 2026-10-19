#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { existsSync, lstatSync, unlinkSync, chmodSync, realpathSync } from 'node:fs';
import { authenticationPath, initializeAuthentication } from '@ctlflow/fleetd-storage/authentication';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { controller as parseController } from '@ctlflow/crossfire-contracts/schema/controller';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { prepareControllerRoot } from '@ctlflow/fleetd-storage/controller-root';
import { createController } from '@ctlflow/fleetd-domain/controller';
import type { Execution } from '@ctlflow/fleetd-domain/port';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { piRuntime } from '@ctlflow/crossfire-adapter-pi/owned';
import { connectMatrix } from '@ctlflow/crossfire-adapter-matrix/connection';
import { createExecution } from '@ctlflow/fleetd-adapter-execution/execution';
import { createDaemonHttp } from './http.js';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import { readLoggingConfiguration } from '@ctlflow/fleetd-storage/logging';
import { createDiagnosticLog } from '@ctlflow/crossfire-adapter-filesystem/logging';
import { createLoggingMaintenance } from '@ctlflow/crossfire-agent-core/logging-maintenance';
import { LOGGING_MAINTENANCE_MS } from '@ctlflow/crossfire-kernel/logging';
import { success } from '@ctlflow/crossfire-kernel/result';

export async function startDaemon(root: string, name?: string, execution?: Execution, configuration = authenticationPath()) {
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Fleet controller requires Linux or macOS');
  let parsed = parseController({ name: name ?? 'local' });
  if (!parsed.ok) throw new Error(parsed.error.message);
  prepareControllerRoot(root);
  const authenticationKey = await initializeAuthentication(configuration);
  const loggingConfiguration = readLoggingConfiguration(root);
  if (!loggingConfiguration.ok) throw new Error(loggingConfiguration.error.message);
  const unlock = await acquireProcessLock(join(root, 'daemon'));
  let cleanup = unlock;
  let acquiredDiagnostics: ReturnType<typeof createDiagnosticLog> | undefined;
  try {
    const diagnostics = acquiredDiagnostics = createDiagnosticLog(join(root, 'logs'), loggingConfiguration.value.loggingRetentionDays);
    const file = join(root, 'controller.json');
    if (existsSync(file)) {
      const existing = parseController(readJson<unknown>(file));
      if (!existing.ok || name !== undefined && existing.value.name !== name) throw new Error('Controller root is already named differently');
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
    const created = createController({ registry: createRegistry(root), execution: execution ?? createExecution({ codex: codexRuntime(), pi: piRuntime() }, connectMatrix,
      dirname(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/artifacts'))), diagnostics.write), controller: parsed.value,
      loggingRetentionDays: loggingConfiguration.value.loggingRetentionDays, id: randomUUID, now: Date.now, delay: nativeClock.delay });
    if (!created.ok) throw new Error(created.error.message);
    const controller = created.value;
    cleanup = async () => { try { await controller.close(); } finally { await unlock(); } };
    const logging = createLoggingMaintenance(nativeClock, async () => {
      const files = await diagnostics.prune();
      const records = controller.maintainHistory();
      if (!records.ok) return records;
      if (!files.ok) return files;
      return success({ more: records.value.more });
    }, LOGGING_MAINTENANCE_MS, diagnostics.maintenanceError);
    cleanup = async () => { try { await logging.close(); await controller.close(); } finally { await unlock(); } };
    let closing: Promise<void> | undefined;
    const server = createDaemonHttp(controller, authenticationKey, () => { void close(); }, () => ({ loggingRetentionDays: loggingConfiguration.value.loggingRetentionDays,
      loggingError: diagnostics.error() }));
    const close = () => closing ??= (async () => {
      try { await logging.close(); await controller.close(); }
      finally {
        server.closeAllConnections();
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        await unlock();
        diagnostics.close();
      }
    })();
    cleanup = close;
    server.listen(socketPath); await once(server, 'listening'); chmodSync(socketPath, 0o600);
    diagnostics.write('Fleet controller ready: ' + parsed.value.name);
    return { controller, close, socketPath, diagnostics };
  } catch (error) { acquiredDiagnostics?.write(error instanceof Error ? error.message : 'Fleet controller failed'); await cleanup(); acquiredDiagnostics?.close(); throw error; }
}
const invoked = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, name: { type: 'string' } } });
  if (!values.root) throw new Error('fleetd --root ABSOLUTE_DIRECTORY [--name NAME]');
  const daemon = await startDaemon(resolve(values.root), values.name);
  console.log(JSON.stringify({ status: 'ready', controller: daemon.controller.status().controller, socket: daemon.socketPath }));
  const fatal = (error: Error) => daemon.diagnostics.write('Fleet controller process failed: ' + error.message);
  process.on('uncaughtExceptionMonitor', fatal);
  process.on('warning', warning => daemon.diagnostics.write('Node warning: ' + warning.message));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => { void daemon.close(); });
}
