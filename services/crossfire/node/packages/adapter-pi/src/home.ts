import { lstatSync, realpathSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { privateDir, readPrivateBytes, writePrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { failureError } from '@ctlflow/crossfire-kernel/result';

export function piDirectories(input: { workspace: string; stateDirectory: string }): void {
  if (!['linux', 'darwin'].includes(process.platform) || !process.getuid) throw failureError({ code: 'invalid', message: 'Managed Pi requires Linux or macOS native ownership primitives' });
  for (const directory of [input.workspace, input.stateDirectory]) {
    if (!isAbsolute(directory) || realpathSync(directory) !== resolve(directory) || !lstatSync(directory).isDirectory()) throw failureError({ code: 'invalid', message: 'Pi requires exact existing directories without symbolic links' });
  }
  const state = lstatSync(input.stateDirectory);
  if (state.uid !== process.getuid() || state.mode & 0o077) throw failureError({ code: 'invalid', message: 'Managed Pi state must be an owned private directory' });
}
export function piHome(stateDirectory: string): string { return privateDir(join(stateDirectory, '.pi')); }
export function refreshPiAuthentication(home: string): void {
  const source = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  if (!isAbsolute(source)) throw failureError({ code: 'invalid', message: 'The host Pi login directory must be an absolute path' });
  if (lstatSync(source, { throwIfNoEntry: false }) && (realpathSync(source) !== resolve(source) || realpathSync(source) === realpathSync(home))) {
    throw failureError({ code: 'invalid', message: 'The host Pi login directory must be separate and cannot traverse symbolic links' });
  }
  for (const name of ['auth.json', 'models.json']) {
    const file = join(source, name), target = join(home, name);
    if (lstatSync(file, { throwIfNoEntry: false })) {
      const bytes = readPrivateBytes(file, 1024 * 1024);
      let parsed: unknown;
      try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; }
      catch { throw failureError({ code: 'unauthorized', message: 'Invalid private Pi ' + name + '; configure it on the host, never in chat' }); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failureError({ code: 'unauthorized', message: 'Invalid private Pi ' + name + '; configure it on the host, never in chat' });
      writePrivateBytes(target, bytes, 1024 * 1024);
    } else if (lstatSync(target, { throwIfNoEntry: false })) {
      readPrivateBytes(target, 1024 * 1024); unlinkSync(target);
      const directory = openSync(home, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
}
export function piEnvironment(home: string, stateDirectory: string, profile: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: home, CROSSFIRE_PROJECT: stateDirectory, CROSSFIRE_AGENT_NAME: profile };
  delete environment.CODEX_THREAD_ID;
  return environment;
}
