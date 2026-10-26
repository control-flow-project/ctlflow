import { existsSync, lstatSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'smol-toml';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { validateRoster } from '@ctlflow/fleetd-contracts/configuration';
import type { Registry } from '@ctlflow/fleetd-domain/port';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { MAX_JSON_BYTES } from '@ctlflow/crossfire-contracts/limits';
import { loadConfiguration } from './configuration.js';
import { createSetupStorage } from './setup.js';
import { resumeSelections } from './resume-selection.js';
import { operationStorage } from './operation.js';

const registrations = check.list(check.object({ fleetId: check.identifier, fleetKey: check.name, directory: check.text(4096), label: check.text(100), revision: check.integer(), digest: check.text(64, 64) }), 100);
const desiredRelation = check.list(check.object({ fleetId: check.identifier, instanceKey: check.name }), 10000);
const DESIRED_INTENT_BYTES = 2 * 1024 * 1024;
const desiredIntent: typeof desiredRelation = input => {
  const parsed = desiredRelation(input);
  if (!parsed.ok) return parsed;
  if (new Set(parsed.value.map(item => item.fleetId + ':' + item.instanceKey)).size !== parsed.value.length) return failure('invalid', 'Duplicate desired binding');
  const counts = new Map<string, number>();
  for (const item of parsed.value) {
    const count = (counts.get(item.fleetId) ?? 0) + 1;
    if (count > 100) return failure('invalid', 'A fleet supports at most 100 desired bindings');
    counts.set(item.fleetId, count);
  }
  if (counts.size > 100) return failure('invalid', 'Controller supports at most 100 desired fleets');
  return success(parsed.value.toSorted((left, right) => left.fleetId.localeCompare(right.fleetId) || left.instanceKey.localeCompare(right.instanceKey)));
};
function attempt<Value>(action: () => Result<Value>): Result<Value> {
  try { return action(); } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Private controller storage failed'); }
}
export function createRegistry(root: string): Registry {
  privateDir(root);
  const setup = createSetupStorage(root);
  const operations = operationStorage(root);
  function read<Value>(name: string, parser: check.Parser<Value>, initial: Value, maximum = MAX_JSON_BYTES): Result<Value> {
    return attempt(() => lstatSync(join(root, name), { throwIfNoEntry: false }) ? parser(readJson<unknown>(join(root, name), maximum)) : success(initial));
  }
  function save<Value>(name: string, parser: check.Parser<Value>, values: Value, maximum = MAX_JSON_BYTES): Result<void> {
    return attempt(() => { const valid = parser(values); if (!valid.ok) return valid; writeJson(join(root, name), valid.value, maximum); return success(undefined); });
  }
  return {
    setup: setup.setup, completeSetup: setup.complete, retrySetup: setup.retry,
    registrations: () => read('fleets.json', registrations, []), saveRegistrations: values => save('fleets.json', registrations, values),
    desiredIntent: () => read('desired-intent.json', desiredIntent, [], DESIRED_INTENT_BYTES), saveDesiredIntent: values => save('desired-intent.json', desiredIntent, values, DESIRED_INTENT_BYTES),
    resumeSelections: () => read('resume-selections.json', resumeSelections, []), saveResumeSelections: values => save('resume-selections.json', resumeSelections, values),
    ...operations,
    load: loadConfiguration,
    writeRoster(configuration, roster) {
      return attempt(() => {
        const wire = { ...roster, instances: roster.instances.map(({ listenerOptions, runtimeOptions, ...instance }) => ({ ...instance,
          ...(runtimeOptions ? { runtime_options: runtimeOptions } : {}),
          ...(listenerOptions ? { listener_options: { ...(listenerOptions.historyMode === undefined ? {} : { history_mode: listenerOptions.historyMode }),
            ...(listenerOptions.mirrorOutput === undefined ? {} : { mirror_output: listenerOptions.mirrorOutput }) } } : {}) })) };
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
