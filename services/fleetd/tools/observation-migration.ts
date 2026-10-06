import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, writeFileSync, fsyncSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { observation, type RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { privateDir, readPrivateBytes, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { paths, readProfile } from '@ctlflow/crossfire-adapter-filesystem/project';
import { loadBinding } from '@ctlflow/fleetd-storage/binding';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';

const maximum = 64 * 1024 * 1024;
const previousFields = ['sessionId', 'roomId', 'runtime', 'state', 'observedAt', 'settings', 'errorMessage', 'historyMode', 'maxInputBytes'];
type Journal = { output: unknown[]; observations: RuntimeObservation[] };

export function convertObservationJournal(input: unknown): Result<{ journal: Journal; converted: number }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid', 'Expected an observation journal');
  const source = input as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || !Array.isArray(source.output) || !Array.isArray(source.observations)) return failure('invalid', 'Unknown observation journal structure');
  const observations: Journal['observations'] = [];
  let converted = 0;
  for (const value of source.observations) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid', 'Invalid journal observation');
    const record = value as Record<string, unknown>;
    const prior = Object.keys(record).length === previousFields.length && previousFields.every(field => Object.hasOwn(record, field));
    const parsed = observation(prior ? { ...record, lastActivityAt: null, historyAvailable: null } : record);
    if (!parsed.ok) return parsed;
    observations.push(parsed.value);
    if (prior) converted++;
  }
  return success({ journal: { output: source.output, observations }, converted });
}

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function ownedDirectory(path: string): void {
  const information = lstatSync(path);
  if (!path.startsWith('/') || resolve(path) !== path || realpathSync(path) !== path || !information.isDirectory()
    || information.uid !== process.getuid!() || information.mode & 0o077) throw new Error('Select an existing owned private directory');
}
function saveBytes(path: string, bytes: Buffer): void {
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  if (!readPrivateBytes(path, maximum).equals(bytes)) throw new Error('Journal backup verification failed');
}

export function migrateObservationJournals(input: { root: string; directory: string; backup: string }, signal: AbortSignal): Result<unknown> {
  const locks: (() => void)[] = [];
  let converted = 0;
  try {
    signal.throwIfAborted();
    ownedDirectory(input.root);
    if (!input.backup.startsWith('/') || resolve(input.backup) !== input.backup || existsSync(input.backup)
      || [input.root, input.directory].some(path => input.backup === path || input.backup.startsWith(path + '/'))) return failure('invalid', 'Select a new backup directory outside controller and fleet state');
    locks.push(acquireFileLock(join(input.root, 'daemon')));
    const configuration = loadConfiguration(input.directory); if (!configuration.ok) return configuration;
    const binding = loadBinding(configuration.value); if (!binding.ok) return binding;
    const registrations = createRegistry(input.root).registrations(); if (!registrations.ok) return registrations;
    const registered = registrations.value.filter(fleet => fleet.directory === configuration.value.directory);
    if (registered.length !== 1 || registered[0]!.fleetKey !== configuration.value.roster.fleet || !binding.value.fleetId
      || binding.value.fleetKey !== configuration.value.roster.fleet || binding.value.server !== configuration.value.roster.coordination.server
      || binding.value.owner !== configuration.value.roster.coordination.owner) return failure('conflict', 'Select the exact registered and enrolled fleet/controller');
    const plans: { key: string; path: string; sha256: string; converted: number }[] = [];
    for (const instance of configuration.value.roster.instances) {
      signal.throwIfAborted();
      const workarea = join(configuration.value.directory, instance.workarea);
      if (!existsSync(workarea)) continue;
      const local = paths(workarea, instance.key), file = local.cursors + '.observation';
      if (!existsSync(file)) continue;
      const identity = binding.value.identities.find(value => value.instanceKey === instance.key);
      const profile = readProfile(local.profile);
      if (!identity || profile.id !== identity.agentId || profile.workspace !== workarea
        || !isDeepStrictEqual(profile.account, identity.account) || profile.settings.owner !== binding.value.owner
        || profile.settings.homeserver !== binding.value.server) return failure('conflict', 'Observation journal does not belong to its exact fleet identity');
      ownedDirectory(local.state);
      locks.push(acquireFileLock(join(local.state, 'listener')));
      locks.push(acquireFileLock(join(local.state, 'receiver')));
      const bytes = readPrivateBytes(file, maximum);
      const result = convertObservationJournal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!result.ok) return result;
      if (result.value.converted) plans.push({ key: instance.key, path: file, sha256: digest(bytes), converted: result.value.converted });
    }
    if (!plans.length) return success({ converted: 0, files: [], backup: null });
    privateDir(input.backup);
    for (const plan of plans) {
      signal.throwIfAborted();
      const bytes = readPrivateBytes(plan.path, maximum);
      if (digest(bytes) !== plan.sha256) throw new Error('Observation journal changed during locked migration');
      saveBytes(join(input.backup, plan.key + '.json'), bytes);
    }
    writeJson(join(input.backup, 'manifest.json'), { fleetId: binding.value.fleetId, plans });
    for (const plan of plans) {
      signal.throwIfAborted();
      const bytes = readPrivateBytes(plan.path, maximum);
      if (digest(bytes) !== plan.sha256) throw new Error('Observation journal changed after its verified backup');
      const result = convertObservationJournal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!result.ok) throw new Error(result.error.message);
      writeJson(plan.path, result.value.journal, maximum);
      const written = convertObservationJournal(JSON.parse(readPrivateBytes(plan.path, maximum).toString('utf8')));
      if (!written.ok || written.value.converted || !isDeepStrictEqual(written.value.journal, result.value.journal)) throw new Error('Current observation journal verification failed');
      converted++;
    }
    return success({ converted, files: plans.map(plan => ({ instanceKey: plan.key, observations: plan.converted, sha256: plan.sha256 })), backup: input.backup });
  } catch (error) {
    return failure('unavailable', 'Observation migration stopped after ' + converted + ' verified files: '
      + (error instanceof Error ? error.message : 'Cannot safely inspect private state'));
  } finally { for (const release of locks.reverse()) release(); }
}
