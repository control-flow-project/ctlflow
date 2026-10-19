import { truncateUtf16 } from '@ctlflow/crossfire-kernel/text';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { stringify } from 'smol-toml';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { setupInput } from '@ctlflow/fleetd-contracts/setup';
import type { SetupInput, SetupConfiguration } from '@ctlflow/fleetd-domain/model';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { loadConfiguration } from './configuration.js';

const setupRecord = check.object({ directory: check.text(4096), operationId: check.identifier, completed: check.boolean,
  server: check.text(2048), owner: check.backendUserId, workspace: check.text(4096), instructions: check.plainText(128 * 1024) });
const records = check.list(setupRecord, 1000);
type Record = check.Parsed<typeof setupRecord>;
export function generatedName(project: string, identity: string): string {
  const prefix = project.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return (/^[a-z]/u.test(prefix) ? prefix : 'project-' + prefix).slice(0, 27).replace(/-+$/u, '') + '-' + identity.slice(0, 12);
}
function workspace(path: string): Result<string> {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) return failure('invalid', 'Workspace must be an absolute, non-symlink directory');
  const information = lstatSync(path);
  return information.isDirectory() && information.uid === process.getuid!() && !(information.mode & 0o002)
    ? success(path) : failure('invalid', 'Workspace must be owned and not writable by other users');
}
export function createSetupStorage(root: string) {
  const file = join(root, 'setups.json');
  function read(): Record[] {
    const parsed = records(existsSync(file) ? readJson<unknown>(file, 2 * 1024 * 1024) : []);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  }
  function save(values: Record[]): void { writeJson(file, values, 2 * 1024 * 1024); }
  function setup(input: SetupInput): Result<SetupConfiguration> {
    try {
      const valid = setupInput(input); if (!valid.ok) return valid;
      const selected = workspace(input.workspace); if (!selected.ok) return selected;
      const digest = createHash('sha256').update(JSON.stringify({ workspace: selected.value, server: input.descriptor.server, owner: input.descriptor.ownerBackendUserId })).digest('hex');
      let directory: string;
      if (input.configuration) {
        if (!isAbsolute(input.configuration) || resolve(input.configuration) !== input.configuration || basename(input.configuration) !== 'runtime.toml') return failure('invalid', 'Configuration must be an absolute runtime.toml path');
        directory = dirname(input.configuration);
      } else directory = join(root, 'projects', digest);
      const stored = read(), previous = stored.find(record => record.directory === directory);
      if (previous && (previous.server !== input.descriptor.server || previous.owner !== input.descriptor.ownerBackendUserId || previous.workspace !== selected.value)) return failure('conflict', 'Saved setup authority or workspace differs; identities are never silently reassigned');
      if (!input.configuration && !previous && !existsSync(directory)) {
        const projects = privateDir(join(root, 'projects')), staging = join(projects, '.setup-' + randomUUID());
        mkdirSync(staging, { mode: 0o700 });
        try {
          const name = generatedName(basename(selected.value), digest), role = privateDir(join(staging, 'agents', 'project'));
          writeFileSync(join(staging, 'runtime.toml'), stringify({ fleet: name, coordination: { adapter: 'crossfire', server: input.descriptor.server, owner: input.descriptor.ownerBackendUserId },
            instances: [{ key: name, name, definition: 'project', workarea: 'agents/project/workarea/' + name, workspace: selected.value }] }), { mode: 0o600, flag: 'wx', flush: true });
          writeFileSync(join(role, 'agent.toml'), stringify({ name: truncateUtf16(basename(selected.value), 100) || 'Project', runtime: 'codex',
            runtime_options: { sandbox_mode: 'danger-full-access', approval_policy: 'on-request', dangerously_bypass_approvals_and_sandbox: false } }), { mode: 0o600, flag: 'wx', flush: true });
          writeFileSync(join(role, 'AGENTS.md'), 'Work in the configured project workspace. Follow its instructions and the authorized human requests. This is a separate fleet-managed agent; the coding session performing setup is not your conversation.\n', { mode: 0o600, flag: 'wx', flush: true });
          for (const folder of [role, dirname(role), staging]) {
            const descriptor = openSync(folder, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
          }
          renameSync(staging, directory);
          const descriptor = openSync(projects, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
        } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
      }
      const loaded = loadConfiguration(directory); if (!loaded.ok) return loaded;
      if (loaded.value.roster.coordination.server !== input.descriptor.server || loaded.value.roster.coordination.owner !== input.descriptor.ownerBackendUserId) return failure('conflict', 'Configuration authority must match the verified setup descriptor');
      if (!loaded.value.roster.instances.length) return failure('invalid', 'Setup requires at least one configured agent');
      const record = previous ?? { directory, operationId: randomUUID(), completed: false, server: input.descriptor.server,
        owner: input.descriptor.ownerBackendUserId, workspace: selected.value, instructions: input.descriptor.instructions };
      if (!previous) { if (stored.length >= 1000) return failure('capacity', 'Private setup registry is full'); save([...stored, record]); }
      writeJson(join(directory, '.fleet', 'setup-instructions.json'), { instructions: record.instructions }, 256 * 1024);
      const configuration = loadConfiguration(directory); if (!configuration.ok) return configuration;
      return success({ configuration: configuration.value, operationId: record.operationId, completed: record.completed });
    } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot prepare private project setup'); }
  }
  function complete(operationId: string): Result<void> {
    try {
      const stored = read(), previous = stored.find(record => record.operationId === operationId);
      if (previous && !previous.completed) save(stored.map(record => record === previous ? { ...record, completed: true } : record));
      return success(undefined);
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Cannot persist setup completion'); }
  }
  function retry(previousId: string, operationId: string): Result<void> {
    try {
      const stored = read(), previous = stored.find(record => record.operationId === previousId);
      if (!previous || previous.completed || !check.identifier(operationId).ok) return failure('conflict', 'Only an incomplete setup can retry its initial operation');
      save(stored.map(record => record === previous ? { ...record, operationId } : record));
      return success(undefined);
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Cannot persist setup retry'); }
  }
  return { setup, complete, retry };
}
