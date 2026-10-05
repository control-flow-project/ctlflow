import { existsSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'smol-toml';
import { privateDir, readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';
import { operationView } from '@fleetd/contracts/api';
import { validateRoster } from '@fleetd/contracts/configuration';
import type { Registry } from '@fleetd/domain/port';
import { failure, success, type Result } from '@crossfire/kernel/result';
import { loadConfiguration } from './configuration.js';

const registrations = check.list(check.object({ fleetId: check.identifier, fleetKey: check.name, directory: check.text(4096), label: check.text(100), revision: check.integer(), digest: check.text(64, 64) }), 100);
const operations = check.list(operationView, 700);
function attempt<Value>(action: () => Result<Value>): Result<Value> {
  try { return action(); } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Private controller storage failed'); }
}
export function createRegistry(root: string): Registry {
  privateDir(root);
  function read<Value>(name: string, parser: check.Parser<Value>, initial: Value): Result<Value> {
    return attempt(() => existsSync(join(root, name)) ? parser(readJson<unknown>(join(root, name))) : success(initial));
  }
  function save<Value>(name: string, parser: check.Parser<Value>, values: Value): Result<void> {
    return attempt(() => { const valid = parser(values); if (!valid.ok) return valid; writeJson(join(root, name), valid.value); return success(undefined); });
  }
  return {
    registrations: () => read('fleets.json', registrations, []), saveRegistrations: values => save('fleets.json', registrations, values),
    operations: () => read('operations.json', operations, []), saveOperations: values => save('operations.json', operations, values),
    load: loadConfiguration,
    writeRoster(configuration, roster) {
      return attempt(() => {
        const wire = { ...roster, instances: roster.instances.map(({ listenerOptions, ...instance }) => ({ ...instance,
          ...(listenerOptions ? { listener_options: listenerOptions.historyMode === undefined ? {} : { history_mode: listenerOptions.historyMode } } : {}) })) };
        const valid = validateRoster(wire);
        if (!valid.ok) return valid;
        const current = loadConfiguration(configuration.directory);
        if (!current.ok) return current;
        if (current.value.digest !== configuration.digest) return failure('stale_revision', 'Fleet files changed; refresh before editing');
        const content = stringify(valid.value), candidate = loadConfiguration(configuration.directory, content);
        if (!candidate.ok) return candidate;
        const temporary = join(configuration.directory, '.runtime-' + randomUUID());
        const descriptor = openSync(temporary, 'wx', 0o600);
        try { writeFileSync(descriptor, content); fsyncSync(descriptor); } finally { closeSync(descriptor); }
        try { renameSync(temporary, join(configuration.directory, 'runtime.toml')); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
        const parent = openSync(configuration.directory, 'r');
        try { fsyncSync(parent); } finally { closeSync(parent); }
        return loadConfiguration(configuration.directory);
      });
    },
  };
}
