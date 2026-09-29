import { existsSync, writeFileSync, constants, openSync, fstatSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';
import { account } from '@crossfire/contracts/client';
import { success } from '@crossfire/kernel/result';
import type { Configuration } from '@fleetd/domain/model';

export const identity = check.object({ instanceKey: check.name, name: check.name, agentId: check.identifier, account });
const parser = check.object({ server: check.text(2048), owner: check.matrixUserId, fleetKey: check.name, fleetId: check.nullable(check.identifier),
  controllerCredential: check.nullable(check.text(200)), request: check.nullable(check.object({ enrollmentId: check.identifier, claimSecret: check.secret, digest: check.text(64, 64) })), identities: check.list(identity, 100) });
export type Binding = check.Parsed<typeof parser>;
export function loadBinding(configuration: Configuration) {
  const file = join(configuration.directory, '.fleet', 'binding.json');
  return existsSync(file) ? parser(readJson<unknown>(file)) : success<Binding>({ server: configuration.roster.coordination.server, owner: configuration.roster.coordination.owner,
    fleetKey: configuration.roster.fleet, fleetId: null, controllerCredential: null, request: null, identities: [] });
}
export function saveBinding(directory: string, binding: Binding): void { writeJson(join(directory, '.fleet', 'binding.json'), binding); }
export function protectFleet(directory: string): void {
  try { execFileSync('git', ['-C', directory, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' }); }
  catch (error) { if (error && typeof error === 'object' && 'status' in error && error.status === 128) return; throw new Error('Git is required to verify fleet credential privacy'); }
  const tracked = execFileSync('git', ['-C', directory, 'ls-files', '--', '.fleet', ':(glob)**/workarea/**'], { encoding: 'utf8' });
  if (tracked.trim()) throw new Error('Private fleet files are tracked by Git; remove them from tracking before starting');
  const file = join(directory, '.gitignore');
  const descriptor = openSync(file, constants.O_CREAT | constants.O_APPEND | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o644);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > 1024 * 1024) throw new Error('Cannot safely update fleet ignore rules');
    const current = readFileSync(descriptor, 'utf8').split(/\r?\n/u), required = ['.fleet/', '**/workarea/'].filter(rule => !current.includes(rule));
    if (required.length) writeFileSync(descriptor, '\n' + required.join('\n') + '\n');
  } finally { closeSync(descriptor); }
  for (const file of ['.fleet/binding.json', 'agents/check/workarea/check/.codex/auth.json', 'agents/check/workarea/check/.crossfire/profiles/check.json']) {
    execFileSync('git', ['-C', directory, 'check-ignore', '--quiet', '--', file], { stdio: 'pipe' });
  }
}
