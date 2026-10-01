import { existsSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { object, userId } from '@crossfire/contracts/validation';
import { profileName, type PendingEnrollment } from '@crossfire/contracts/client';
import { prepareProject, paths, readProfile } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { emit } from './output.js';
import { endpoint } from '@crossfire/contracts/origin';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { enroll, connect } from './enrollment.js';
import { installSoftware } from '@crossfire/adapter-crossfire/software';
import { discoverRuntime, prepareRuntime, runtimeName } from './adapters.js';
import { localListener, startListener } from './listener-process.js';
import { listenerSettings, listenerBinding } from './settings.js';
import { connectionSetup } from './setup.js';

export function selectProfile(workspace: string, requested?: string): string {
  if (requested) { if (!profileName(requested)) throw new Error('Choose a name using lowercase letters, numbers and hyphens'); return requested; }
  const directory = join(workspace, '.crossfire/profiles');
  const state = join(workspace, '.crossfire/state');
  const profiles = existsSync(directory) ? readdirSync(directory).map(file => file.replace(/(?:\.pending)?\.json$/u, '')).filter(profileName) : [];
  const setups = existsSync(state) ? readdirSync(state).filter(name => profileName(name) && existsSync(join(state, name, 'settings.json'))) : [];
  const names = [...new Set([...profiles, ...setups])].sort();
  if (names.length === 1) return names[0]!;
  throw new Error(names.length ? 'Choose --profile from the existing project identities: ' + names.join(', ') : 'What should this agent be called? Supply that name once with --profile NAME.');
}

export async function connectProject(input: { project: string; profile: string | undefined; server: string | undefined; owner: string | undefined; runtime: string | undefined; approvalRoom: string | undefined; file: string; maximum: number }) {
  const workspace = prepareProject(input.project);
  const name = selectProfile(workspace, input.profile);
  const destination = paths(workspace, name);
  const unlock = await acquireProcessLock(join(destination.state, 'connection'), 35);
  try {
    const settings = listenerSettings(destination.state, runtimeName(input.runtime), input.approvalRoom);
    const profile = existsSync(destination.profile) ? readProfile(destination.profile) : undefined;
    const pending = !profile && existsSync(destination.pending) ? readJson<PendingEnrollment>(destination.pending) : undefined;
    const setup = connectionSetup(destination.state);
    const server = profile?.settings.homeserver ?? pending?.server ?? input.server ?? setup.value?.server;
    const owner = profile?.settings.owner ?? pending?.owner ?? input.owner ?? setup.value?.owner;
    const origin = endpoint(server ?? '');
    if (!origin.ok || !userId(owner)) throw new Error('Use the Connect an agent instructions from your Crossfire management page; they supply the server and owner.');
    if (input.server && input.server !== origin.value || input.owner && input.owner !== owner) throw new Error('This profile belongs to a different server or owner; its identity is unchanged');
    const software = await installSoftware(destination.root, origin.value);
    software.activate();
    if (software.skill.changed) emit({ status: 'software-ready', release: software.manifest.release, skill: { ...software.skill, content: readFileSync(software.skill.path, 'utf8') },
      instructions: 'Read this updated project-local skill once in the current coding session. No re-enrollment is needed for existing identities.' }, input.maximum);
    if (realpathSync(input.file) !== realpathSync(software.file)) return { handoff: software.file };
    if (!profile && !pending) setup.save(origin.value, owner);
    settings.save();
    const activation = prepareRuntime(settings.runtime, workspace);
    if (activation) { emit({ status: 'runtime-setup-required', runtime: settings.runtime, instructions: activation }, input.maximum); return {}; }
    const runtime = discoverRuntime(settings.runtime, workspace);
    const binding = listenerBinding(runtime.binding, settings.approvalRoom);
    const running = await localListener(destination, 'status');
    if (running && (running.release !== software.manifest.release || running.binding !== binding || !running.ready)) await localListener(destination, 'stop');
    if (!profile && !pending) {
      const enrolled = await enroll(destination, origin.value, owner, name, software.manifest);
      if (!enrolled.ok) throw new Error(enrolled.error.message);
    }
    setup.complete();
    if (!profile) {
      const request = readJson<PendingEnrollment>(destination.pending);
      emit({ status: 'awaiting-approval', code: request.code, approvalUrl: origin.value + '/manage/enrollments/' + request.request,
        instructions: 'Ask your owner to approve this code and choose room access. This command waits and starts delivery automatically; do not enroll again or model-poll.' }, input.maximum);
    }
    for (;;) {
      const verified = await connect(destination, software.manifest);
      if (!verified.ok) throw new Error(verified.error.message);
      const result = object(verified.value);
      if (!result.ok) throw new Error('Invalid connection result');
      if (result.value.status === 'connected') break;
      if (!['pending', 'provisioning'].includes(String(result.value.status))) throw new Error('Enrollment ' + String(result.value.status));
      await delay(2000);
    }
    const active = await localListener(destination, 'status');
    if (!active?.ready) await startListener(destination, software.file, name);
    const listener = await localListener(destination, 'status');
    if (!listener?.ready || listener.binding !== binding || listener.release !== software.manifest.release) throw new Error('Listener did not confirm this session and release');
    const refreshed = await connect(destination, software.manifest);
    if (!refreshed.ok) throw new Error(refreshed.error.message);
    const updated = object(refreshed.value);
    if (!updated.ok) throw new Error('Invalid connected identity');
    emit({ ...updated.value, status: 'listening', listener, client: join(destination.root, 'client.mjs'), skill: software.skill,
      instructions: 'Delivery is active in this session. The owner assigns rooms in management. Run this same project client with agent connect to reconnect or upgrade; the identity is reused.' }, input.maximum);
    return {};
  } finally { await unlock(); }
}
