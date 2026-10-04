import { lstatSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createDaemonClient, operations } from '@fleet/daemon-client/client';
import { loadConfiguration } from '@fleetd/storage/configuration';
import { loadBinding } from '@fleetd/storage/binding';
import { nativeJson } from '@crossfire/adapter-matrix/http';
import { command } from '@crossfire/operator-support/process';
import { collectPages } from '@crossfire/operator-support/collections';
import { failure, success, type Result } from '@crossfire/kernel/result';
import * as check from '@crossfire/contracts/schema/validation';
import { inspectNative, preserveNative } from './runtime/inspect.js';
import type { NativeInspector } from './runtime/types.js';

export const preservation = check.object({ identities: check.list(check.object({ instanceKey: check.name, agentId: check.identifier,
  contexts: check.list(check.object({ context: check.text(255), sessionId: check.text(200) }), 2002) }), 100),
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

export async function verifyFleet(input: { root: string; directory: string; running: boolean; fresh: boolean; noRooms: boolean;
  skills: string[]; previous?: Preservation }, signal: AbortSignal, native: NativeInspector = inspectNative): Promise<Result<unknown>> {
  if (input.fresh && !input.running) return failure('invalid', 'Fresh native history verification requires --running');
  try {
    const root = lstatSync(input.root), socket = lstatSync(join(input.root, 'fleetd.sock'));
    if (!input.root.startsWith('/') || realpathSync(input.root) !== input.root || !root.isDirectory() || root.uid !== process.getuid!() || root.mode & 0o077
      || !socket.isSocket() || socket.uid !== process.getuid!() || socket.mode & 0o077) return failure('invalid', 'Select the exact owned private controller root/socket');
    const loaded = loadConfiguration(input.directory); if (!loaded.ok) return loaded;
    const configuration = loaded.value, saved = loadBinding(configuration); if (!saved.ok) return saved;
    const binding = saved.value;
    if (binding.server !== configuration.roster.coordination.server || binding.owner !== configuration.roster.coordination.owner
      || binding.fleetKey !== configuration.roster.fleet) return failure('conflict', 'Fleet binding differs from its configured identity');
    const git = await command('git', ['-C', input.directory, 'rev-parse', '--show-toplevel'], signal); if (!git.ok) return git;
    const projectRoot = realpathSync(git.value.trim());
    if (input.directory !== projectRoot && !input.directory.startsWith(projectRoot + '/')) return failure('conflict', 'Fleet is outside its actual Git project boundary');
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
        const attachment = pointer.value.data, workspace = join(input.directory, configured.workarea);
        if (attachment.workspace !== workspace || attachment.runtime !== role.runtime || attachment.sessionId !== history.sessionId) return failure('conflict', 'Native attachment differs from its registered exact history/workspace');
        const result = await native({ attachment, options: role.options, fresh: input.fresh, requiredSkills: input.skills }, signal); if (!result.ok) return result;
        const expectedPaths = [];
        for (let parent = workspace; parent.startsWith(projectRoot + '/') || parent === projectRoot; parent = dirname(parent)) {
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
      if (input.noRooms) {
        const joined = await nativeJson({ base: binding.server, token: identity.account.access_token, signal }, 'GET', '/_matrix/client/v3/joined_rooms');
        if (!joined.ok) return joined;
        const body = joined.value.body;
        if (joined.value.status !== 200 || !body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.joined_rooms) || body.joined_rooms.length) return failure('conflict', 'Native agent has unexpected joined rooms');
      }
      const preserved = preserveNative(role.runtime, join(input.directory, configured.workarea));
      if (!preserved.ok) return preserved;
      files.push(...preserved.value);
      instances.push({ instanceKey: configured.key, name: configured.name, phase: instance.phase, listenerActive: instance.listenerActive,
        historyMode: configured.listener_options?.history_mode ?? 'shared',
        histories: inspected });
    }
    identities.sort((left, right) => left.instanceKey.localeCompare(right.instanceKey)); files.sort((left, right) => left.path.localeCompare(right.path));
    const current: Preservation = { identities, files };
    if (input.previous) {
      const retained = verifyRetainedState(input.previous, current);
      if (!retained.ok) return retained;
    }
    return success({ checkedAt: new Date().toISOString(), controller: fleet.controller.name, localFleetId: fleet.fleetId, crossfireFleetId: binding.fleetId,
      fleetKey: fleet.fleetKey, projectRoot, connected: fleet.connection.connected, deliveryEnabled: fleet.connection.deliveryEnabled,
      instances, preservation: current, modelCalls: 0 });
  } catch { return failure('invalid', 'Cannot safely inspect this controller/fleet filesystem'); }
}
