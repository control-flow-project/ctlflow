import { existsSync, renameSync, lstatSync, realpathSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { paths, readProfile } from '@ctlflow/crossfire-adapter-filesystem/project';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import type { Configuration } from '@ctlflow/fleetd-domain/model';
import type { Binding } from './binding.js';

const migration = check.object({ agentId: check.identifier, source: check.name, target: check.name, hadState: check.boolean });
function verifyState(directory: string): void {
  const information = lstatSync(directory);
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== process.getuid!()
    || information.mode & 0o077 || realpathSync(directory) !== resolve(directory)) throw new Error('Profile migration state must be an owned private directory');
  const unlock = acquireFileLock(join(directory, 'listener'));
  unlock();
}

export function migrateInstanceProfiles(configuration: Configuration, binding: Binding): void {
  for (const instance of configuration.roster.instances) {
    const identity = binding.identities.find(item => item.instanceKey === instance.key);
    if (!identity) continue;
    const workarea = join(configuration.directory, instance.workarea);
    if (!existsSync(workarea)) continue;
    const current = paths(workarea, instance.key), journal = join(current.root, 'profile-migration-' + instance.key + '.json');
    const loaded = existsSync(journal) ? migration(readJson<unknown>(journal)) : null;
    if (loaded && !loaded.ok) throw new Error(loaded.error.message);
    const pending = loaded?.ok ? loaded.value : null;
    if (pending && (pending.agentId !== identity.agentId || pending.target !== instance.key)) throw new Error('Profile migration journal belongs to another identity');
    if (!pending && identity.name === instance.key) continue;
    const previous = paths(workarea, pending?.source ?? identity.name);
    if (!pending && !existsSync(previous.profile)) {
      if (existsSync(previous.state)) throw new Error('Profile migration has state without its private identity');
      continue;
    }
    if (existsSync(previous.profile) === existsSync(current.profile)) throw new Error('Profile migration needs exactly one owned identity profile');
    const profile = readProfile(existsSync(previous.profile) ? previous.profile : current.profile);
    if (profile.id !== identity.agentId || profile.account.user_id !== identity.account.user_id
      || profile.settings.homeserver !== binding.server || profile.settings.owner !== binding.owner) throw new Error('Profile migration identity does not match its fleet');
    let intent = pending;
    if (!intent) {
      if (existsSync(current.state)) throw new Error('Profile migration would merge two listener histories');
      const hadState = existsSync(previous.state);
      if (hadState) verifyState(previous.state);
      intent = { agentId: identity.agentId, source: identity.name, target: instance.key, hadState };
      writeJson(journal, intent);
    }
    if (intent.hadState) {
      if (existsSync(previous.state) === existsSync(current.state)) throw new Error('Profile migration needs exactly one listener history');
      verifyState(existsSync(previous.state) ? previous.state : current.state);
      if (existsSync(previous.state)) renameSync(previous.state, current.state);
    } else if (existsSync(previous.state) || existsSync(current.state)) throw new Error('Profile migration state changed unexpectedly');
    privateDir(dirname(current.profile));
    if (existsSync(previous.profile)) renameSync(previous.profile, current.profile);
    for (const directory of new Set([dirname(current.profile), dirname(current.state), current.root])) {
      if (!existsSync(directory)) continue;
      const descriptor = openSync(directory, 'r');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    }
    unlinkSync(journal);
  }
}
