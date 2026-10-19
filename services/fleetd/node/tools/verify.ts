import { MAX_HISTORY_CONTEXT } from '@ctlflow/crossfire-kernel/history-context';
import { lstatSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { loadBinding } from '@ctlflow/fleetd-storage/binding';
import { nativeOptions } from '@ctlflow/fleetd-domain/model';
import type { MessagingConnector } from '@ctlflow/crossfire-domain/port/messaging-client';
import type { BackendConfiguration } from '@ctlflow/crossfire-domain/port/messaging';
import { createClient } from '@ctlflow/crossfire-client/client';
import { operations as serverOperations } from '@ctlflow/crossfire-contracts/rest/operations';
import { command } from '@ctlflow/crossfire-operator-support/process';
import { collectPages } from '@ctlflow/crossfire-operator-support/collections';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { inspectNative, preserveNative } from './runtime/inspect.js';
import type { NativeInspector } from './runtime/types.js';

export const preservation = check.object({ identities: check.list(check.object({ instanceKey: check.name, agentId: check.identifier,
  contexts: check.list(check.object({ context: check.text(MAX_HISTORY_CONTEXT), sessionId: check.text(200) }), 2002) }), 100),
  files: check.list(check.object({ path: check.text(4096), bytes: check.integer(), sha256: check.text(64, 64) }), 1000) });
export type Preservation = check.Parsed<typeof preservation>;

export function verifyRetainedState(previous: Preservation, current: Preservation): Result<void> {
  for (const snapshot of [previous, current]) {
    if (new Set(snapshot.identities.map(identity => identity.instanceKey)).size !== snapshot.identities.length
      || new Set(snapshot.identities.map(identity => identity.agentId)).size !== snapshot.identities.length
      || new Set(snapshot.files.map(file => file.path)).size !== snapshot.files.length) return failure('invalid', 'Preservation snapshots must contain unique identities and file paths');
  }
  const identities = new Map(current.identities.map(identity => [identity.instanceKey, identity]));
  const files = new Map(current.files.map(file => [file.path, file]));
  if (previous.identities.some(identity => !isDeepStrictEqual(identities.get(identity.instanceKey), identity))
    || previous.files.some(file => !isDeepStrictEqual(files.get(file.path), file))) return failure('conflict', 'Enrolled accounts, native histories or provider-file fingerprints changed');
  return success(undefined);
}
async function projectBoundary(workspace: string, signal: AbortSignal): Promise<Result<string | null>> {
  for (let current = workspace; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) {
      const git = await command('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], signal); if (!git.ok) return git;
      const root = realpathSync(git.value.trim());
      return workspace === root || workspace.startsWith(root + '/') ? success(root) : failure('conflict', 'Native workspace differs from its actual Git boundary');
    }
    if (current === dirname(current)) return success(null);
  }
}

export async function verifyFleet(input: { root: string; directory: string; running: boolean; fresh: boolean; noRooms: boolean;
  skills: string[]; previous?: Preservation }, signal: AbortSignal, connect: MessagingConnector, native: NativeInspector = inspectNative): Promise<Result<unknown>> {
  if (input.fresh && !input.running) return failure('invalid', 'Fresh native history verification requires --running');
  try {
    const root = lstatSync(input.root), socket = lstatSync(join(input.root, 'fleetd.sock'));
    if (!input.root.startsWith('/') || realpathSync(input.root) !== input.root || !root.isDirectory() || root.uid !== process.getuid!() || root.mode & 0o077
      || !socket.isSocket() || socket.uid !== process.getuid!() || socket.mode & 0o077) return failure('invalid', 'Select the exact owned private controller root/socket');
    const loaded = loadConfiguration(input.directory); if (!loaded.ok) return loaded;
    const configuration = loaded.value, saved = loadBinding(configuration); if (!saved.ok) return saved;
    const binding = saved.value;
    let backend: BackendConfiguration | undefined;
    if (input.noRooms) {
      const selected = await createClient({ origin: binding.server, signal }).call(serverOperations.messagingBackend, {}, {});
      if (!selected.ok) return selected;
      backend = selected.value.data.configuration;
    }
    if (binding.server !== configuration.roster.coordination.server || binding.owner !== configuration.roster.coordination.owner
      || binding.fleetKey !== configuration.roster.fleet) return failure('conflict', 'Fleet binding differs from its configured identity');
    const client = createDaemonClient(join(input.root, 'fleetd.sock'), signal);
    const all = await collectPages(query => client.call(operations.fleets, {}, {}, query), fleet => fleet.fleetId);
    if (!all.ok) return all;
    const selected = all.value.filter(fleet => fleet.directory === input.directory);
    if (selected.length !== 1) return failure('conflict', 'Exactly one registered fleet must own this directory');
    const fleet = selected[0]!;
    if (fleet.fleetKey !== configuration.roster.fleet || fleet.instances.length !== configuration.roster.instances.length) return failure('conflict', 'Controller roster differs from the native configuration');
    if (input.running && (fleet.phase !== 'running' || !fleet.connection.connected || !fleet.connection.deliveryEnabled || fleet.error
      || fleet.instances.some(instance => instance.phase !== 'running' || !instance.listenerActive || instance.error))) return failure('conflict', 'Fleet or one of its listeners is not fully running/connected');
    const identities: Preservation['identities'] = [], files: Preservation['files'] = [], instances = [];
    const sessions = new Set<string>();
    for (const instance of fleet.instances) {
      signal.throwIfAborted();
      const role = configuration.definitions[instance.instance.definition];
      const configured = configuration.roster.instances.find(item => item.key === instance.instance.key);
      if (!role || !configured || !isDeepStrictEqual(configured, instance.instance)) return failure('conflict', 'Controller instance differs from its exact current definition/roster');
      const identity = binding.identities.find(item => item.instanceKey === instance.instance.key && item.name === instance.instance.name);
      if (!identity) return failure('conflict', 'Registered instance has no exact enrolled account');
      const workspace = configured.workspace ?? join(input.directory, configured.workarea), boundary = await projectBoundary(workspace, signal);
      if (!boundary.ok) return boundary;
      const projectRoot = boundary.value;
      const contexts = await client.call(operations.contexts, { fleetId: fleet.fleetId, instanceKey: instance.instance.key }, {}); if (!contexts.ok) return contexts;
      if (new Set(contexts.value.data.map(history => history.context)).size !== contexts.value.data.length || contexts.value.data.some(history => history.runtime !== role.runtime)) return failure('conflict', 'Controller history scopes do not match their configured runtime');
      for (const history of contexts.value.data) {
        if (sessions.has(history.sessionId)) return failure('conflict', 'A native history belongs to more than one registered context');
        sessions.add(history.sessionId);
      }
      identities.push({ instanceKey: instance.instance.key, agentId: identity.agentId, contexts: contexts.value.data.map(({ context, sessionId }) => ({ context, sessionId })).sort((left, right) => left.context.localeCompare(right.context)) });
      const inspected = [];
      if (instance.phase === 'running') for (const history of contexts.value.data) {
        const pointer = await client.call(operations.attachment, { fleetId: fleet.fleetId, instanceKey: instance.instance.key }, {}, new URLSearchParams({ context: history.context })); if (!pointer.ok) return pointer;
        const attachment = pointer.value.data;
        if (attachment.workspace !== workspace || attachment.runtime !== role.runtime || attachment.sessionId !== history.sessionId) return failure('conflict', 'Native attachment differs from its registered exact history/workspace');
        const result = await native({ attachment, options: nativeOptions(configuration, configured), fresh: input.fresh, requiredSkills: input.skills }, signal); if (!result.ok) return result;
        const expectedPaths = [];
        for (let parent = workspace; projectRoot !== null && (parent.startsWith(projectRoot + '/') || parent === projectRoot); parent = dirname(parent)) {
          const skills = join(parent, '.agents', 'skills');
          if (existsSync(skills)) for (const entry of readdirSync(skills)) {
            const file = join(skills, entry, 'SKILL.md');
            if (existsSync(file)) {
              const path = realpathSync(file);
              if (path !== file) return failure('invalid', 'Project skill inputs cannot traverse symbolic links');
              expectedPaths.push(path);
            }
          }
          if (parent === projectRoot) break;
        }
        for (const path of expectedPaths) if (!result.value.projectSkills.some(skill => skill.path === path)) return failure('conflict', 'Native discovery missed a skill inside the actual Git project boundary');
        inspected.push({ context: history.context, ...result.value });
      }
      if (input.running && !inspected.length) return failure('conflict', 'Running instance has no inspectable native history');
      if (backend) {
        const joined = await connect(backend, identity.account).transport(signal, 45000).joinedRooms();
        if (joined.length) return failure('conflict', 'Native agent has unexpected joined rooms');
      }
      const preserved = preserveNative(role.runtime, join(input.directory, configured.workarea));
      if (!preserved.ok) return preserved;
      files.push(...preserved.value);
      instances.push({ instanceKey: configured.key, name: configured.name, phase: instance.phase, listenerActive: instance.listenerActive, workspace, projectRoot,
        historyMode: configured.listenerOptions?.historyMode ?? 'shared',
        histories: inspected });
    }
    identities.sort((left, right) => left.instanceKey.localeCompare(right.instanceKey)); files.sort((left, right) => left.path.localeCompare(right.path));
    const current: Preservation = { identities, files };
    if (input.previous) {
      const retained = verifyRetainedState(input.previous, current);
      if (!retained.ok) return retained;
    }
    return success({ checkedAt: new Date().toISOString(), controller: fleet.controller.name, localFleetId: fleet.fleetId, crossfireFleetId: binding.fleetId,
      fleetKey: fleet.fleetKey, connected: fleet.connection.connected, deliveryEnabled: fleet.connection.deliveryEnabled,
      instances, preservation: current, modelCalls: 0 });
  } catch { return failure('invalid', 'Cannot safely inspect this controller/fleet filesystem'); }
}
