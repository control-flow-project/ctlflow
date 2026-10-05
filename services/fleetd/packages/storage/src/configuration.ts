import { openSync, closeSync, fstatSync, readFileSync, realpathSync, constants, lstatSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseToml, validateRoster, definition } from '@fleetd/contracts/configuration';
import type { Configuration, Definition } from '@fleetd/domain/model';
import { failure, success, type Result } from '@crossfire/kernel/result';
import { defaultCoordinationPolicy } from '@crossfire/contracts/coordination-policy';

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
    for (const item of parsed.value.instances) {
      if (!definitions[item.definition]) {
        const root = join(directory, 'agents', item.definition), text = readText(join(root, 'agent.toml'));
        const role = parseToml(text, definition);
        if (!role.ok) return role;
        const instructions = readText(join(root, 'AGENTS.md'), 128 * 1024);
        const policy = role.value.coordination_options;
        definitions[item.definition] = { name: role.value.name, runtime: role.value.runtime, options: role.value.runtime_options, instructions,
          coordinationPolicy: policy ? { wakeMode: policy.wake_mode, senderMatrixIds: policy.sender_matrix_ids ?? [], permissions: policy.permissions } : defaultCoordinationPolicy() };
        hash.update(item.definition).update(text).update(instructions);
      }
      const segments = item.workarea.split('/');
      for (let length = 1; length <= segments.length; length++) {
        const child = join(directory, ...segments.slice(0, length));
        if (existsSync(child) && realpathSync(child) !== child) return failure('invalid', 'Work areas cannot traverse symbolic links');
      }
    }
    const instances = parsed.value.instances.map(({ listener_options, ...instance }) => ({ ...instance,
      ...(listener_options ? { listenerOptions: listener_options.history_mode === undefined ? {} : { historyMode: listener_options.history_mode } } : {}) }));
    return success({ directory, roster: { ...parsed.value, instances }, definitions, digest: hash.digest('hex') });
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot read fleet configuration'); }
}
