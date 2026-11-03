import { openSync, closeSync, fstatSync, readFileSync, realpathSync, constants, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseToml, validateRoster, definition } from '@ctlflow/fleetd-contracts/configuration';
import type { Configuration, Definition } from '@ctlflow/fleetd-domain/model';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

export function readText(file: string, maximum = 1024 * 1024): string {
  const path = resolve(file);
  if (realpathSync(path) !== path) throw new Error('Fleet inputs cannot traverse symbolic links');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > maximum || (info.mode & 0o022) !== 0) throw new Error('Fleet inputs must be bounded owned files, not writable by others');
    const value = readFileSync(descriptor, 'utf8');
    const after = fstatSync(descriptor);
    if (Buffer.byteLength(value) > maximum || info.mtimeMs !== after.mtimeMs || info.size !== after.size) throw new Error('Fleet input changed during inspection');
    return value;
  } finally { closeSync(descriptor); }
}
export function loadConfiguration(directory: string, replacement?: string): Result<Configuration> {
  try {
    if (!directory.startsWith('/') || resolve(directory) !== realpathSync(directory)) return failure('invalid', 'Supply an absolute, non-symlink fleet directory');
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.uid !== process.getuid!() || (info.mode & 0o022) !== 0) return failure('invalid', 'Fleet directory must be owned and not writable by others');
    const source = replacement ?? readText(join(directory, 'runtime.toml')), parsed = parseToml(source, validateRoster);
    if (!parsed.ok) return parsed;
    const definitions: Record<string, Definition> = {}, hash = createHash('sha256').update(source);
    const instructionFile = join(directory, '.fleet', 'setup-instructions.json');
    const setup = lstatSync(instructionFile, { throwIfNoEntry: false }) ? check.object({ instructions: check.plainText(128 * 1024) })(readJson<unknown>(instructionFile, 256 * 1024)) : success({ instructions: '' });
    if (!setup.ok) return setup;
    hash.update(setup.value.instructions);
    for (const item of parsed.value.instances) {
      if (!definitions[item.definition]) {
        const root = join(directory, 'agents', item.definition), text = readText(join(root, 'agent.toml'));
        const role = parseToml(text, definition);
        if (!role.ok) return role;
        const instructions = readText(join(root, 'AGENTS.md'), 128 * 1024);
        const policy = role.value.coordination_options;
        definitions[item.definition] = { name: role.value.name, runtime: role.value.runtime, options: role.value.runtime_options,
          instructions: [instructions, setup.value.instructions].filter(Boolean).join('\n\n'),
          coordinationPolicy: policy ? { wakeMode: policy.wake_mode,
            senders: policy.wake_senders.map(sender => ({ backendUserId: sender.backend_user_id, includeAgents: sender.include_agents })),
            permissions: policy.permissions } : defaultCoordinationPolicy(parsed.value.coordination.owner) };
        hash.update(item.definition).update(text).update(instructions);
      }
      const segments = item.workarea.split('/');
      if (item.workspace) {
        if (realpathSync(item.workspace) !== resolve(item.workspace)) return failure('invalid', 'Native workspaces cannot traverse symbolic links');
        const workspace = lstatSync(item.workspace);
        if (!workspace.isDirectory() || workspace.uid !== process.getuid!() || workspace.mode & 0o002) return failure('invalid', 'Native workspace must be owned and not writable by other users');
      }
      for (let length = 1; length <= segments.length; length++) {
        const child = join(directory, ...segments.slice(0, length));
        const entry = lstatSync(child, { throwIfNoEntry: false });
        if (entry && (realpathSync(child) !== child || !entry.isDirectory() || entry.uid !== process.getuid!() || entry.mode & 0o022)) return failure('invalid', 'Work areas must use owned directories without symbolic links or shared write access');
      }
    }
    const instances = parsed.value.instances.map(({ listener_options, runtime_options, ...instance }) => ({ ...instance,
      ...(runtime_options ? { runtimeOptions: runtime_options } : {}),
      ...(listener_options ? { listenerOptions: { ...(listener_options.history_mode === undefined ? {} : { historyMode: listener_options.history_mode }),
        ...(listener_options.mirror_output === undefined ? {} : { mirrorOutput: listener_options.mirror_output }) } } : {}) }));
    return success({ directory, roster: { ...parsed.value, instances }, definitions, digest: hash.digest('hex') });
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot read fleet configuration'); }
}
