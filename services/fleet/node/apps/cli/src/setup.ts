import { basename, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, realpathSync, lstatSync, openSync, constants, closeSync, fstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { operations, createDaemonClient } from '@ctlflow/fleet-daemon-client/client';
import { parseToml, validateRoster } from '@ctlflow/fleetd-contracts/configuration';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { descriptorUrl } from '@ctlflow/fleetd-contracts/setup';
import { launchDaemon } from './daemon.js';
import { loadConnections, saveConnections } from './configuration.js';
import { fetchSetupDescriptor, installedVersion } from './setup-descriptor.js';
import { observeOperation } from './operation.js';

const stored = check.object({ workspace: check.text(4096), descriptor: check.text(4096), root: check.text(4096), configuration: check.optional(check.text(4096)) });
export type SetupOptions = { descriptor?: string; config?: string; root?: string };
function value<Value>(result: { ok: true; value: Value } | { ok: false; error: { message: string } }): Value {
  if (!result.ok) throw new Error(result.error.message); return result.value;
}
function configuredDescriptor(file: string): string {
  if (basename(file) !== 'runtime.toml' || realpathSync(file) !== file) throw new Error('Supply an absolute, non-symlink runtime.toml configuration');
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const information = fstatSync(descriptor);
    if (!information.isFile() || information.uid !== process.getuid!() || information.size > 1024 * 1024 || information.mode & 0o022) throw new Error('Configuration must be a bounded, owned file not writable by others');
    const configuration = value(parseToml(readFileSync(descriptor, 'utf8'), validateRoster));
    return configuration.coordination.server + '/onboarding/setup.json?ownerMatrixId=' + encodeURIComponent(configuration.coordination.owner);
  } finally { closeSync(descriptor); }
}
export async function setup(options: SetupOptions, signal: AbortSignal, output: (value: unknown) => void): Promise<void> {
  const workspace = realpathSync(process.cwd()), hash = createHash('sha256').update(workspace).digest('hex');
  const configRoot = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  if (!isAbsolute(configRoot)) throw new Error('XDG_CONFIG_HOME must be absolute');
  const recordPath = join(configRoot, 'fleet', 'projects', hash + '.json');
  const previous = existsSync(recordPath) ? value(stored(readJson<unknown>(recordPath))) : undefined;
  if (options.config && !isAbsolute(options.config)) throw new Error('--config requires an absolute runtime.toml path');
  const configuration = options.config ? resolve(options.config) : previous?.configuration;
  const descriptor = options.descriptor ?? (configuration ? configuredDescriptor(configuration) : previous?.descriptor);
  if (!descriptor) throw new Error('Run fleet setup --descriptor PERSONALIZED_SETUP_URL from the Crossfire setup guide, or pass --config /absolute/runtime.toml');
  value(descriptorUrl(descriptor));
  const connections = loadConnections();
  const root = options.root ? resolve(options.root) : previous?.root ?? connections.localRoot ?? join(homedir(), '.ctlflow', 'controller');
  if (root === workspace || workspace.startsWith(root + '/')) throw new Error('Controller state must be separate from and not contain the existing project directory');
  if (previous && (previous.workspace !== workspace || previous.descriptor !== descriptor || previous.root !== root || previous.configuration !== configuration)) throw new Error('This project already has different saved setup authority; use its saved configuration rather than silently replacing identities');
  const verified = value(await fetchSetupDescriptor(descriptor, installedVersion(), signal));
  const information = lstatSync(workspace);
  if (!information.isDirectory() || information.uid !== process.getuid!() || information.mode & 0o002) throw new Error('Current workspace must be owned and not writable by other users');
  writeJson(recordPath, { workspace, descriptor, root, ...(configuration ? { configuration } : {}) });
  output({ status: 'starting-controller', workspace, controllerRoot: root, server: verified.server, owner: verified.ownerMatrixId,
    conversation: 'New fleet-managed agent; this coding session remains independent' });
  const controller = await launchDaemon(root, undefined, signal);
  connections.localRoot = root; saveConnections(connections);
  const client = createDaemonClient(join(root, 'fleetd.sock'), signal);
  const prepared = value(await client.call(operations.setup, {}, { descriptor: verified, workspace, ...(configuration ? { configuration } : {}) })).data;
  if (prepared.operation) {
    output({ operationId: prepared.operation.operationId, fleet: prepared.fleet.fleetKey });
    await observeOperation(client, prepared.operation, signal, output);
  }
  let current = value(await client.call(operations.fleet, { fleetId: prepared.fleet.fleetId }, {})).data;
  if (prepared.status !== 'stopped') {
    const deadline = Date.now() + 65000;
    while (!current.connection.connected || current.instances.some(instance => instance.desiredActive && (!instance.sessionId || !['running', 'sleeping'].includes(instance.phase)))) {
      if (current.error || current.instances.some(instance => instance.desiredActive && instance.phase === 'failed') || Date.now() >= deadline) {
        throw new Error('Setup did not reach a ready controller/listener/native binding; inspect fleet show ' + current.fleetKey + '. No model prompt was sent.');
      }
      await delay(100, undefined, { signal });
      current = value(await client.call(operations.fleet, { fleetId: prepared.fleet.fleetId }, {})).data;
    }
  }
  if (prepared.status !== 'stopped') value(await client.call(operations.readiness, { fleetId: current.fleetId }, {}));
  output({ status: prepared.status === 'stopped' ? 'stopped' : 'ready', controller: controller.controller.name, fleet: current.fleetKey,
    agentCount: current.instances.length, histories: 'retained', message: prepared.status === 'stopped'
      ? 'Existing stop intent is preserved. Run fleet start ' + current.fleetKey + ' when ready.' : 'Controller and agent bindings are ready; no rooms were created and no model prompt was sent.' });
}
