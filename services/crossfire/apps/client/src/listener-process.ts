import { existsSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readJson, privateDir } from '@crossfire/adapter-filesystem/index';
import { fields } from '@crossfire/contracts/validation';
import { releaseName } from '@crossfire/contracts/release';
import type { paths } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { emit } from './output.js';
import type { ListenerOptions } from '@crossfire/adapter-crossfire/listener';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { isListenerStop } from '@crossfire/agent-core/lifecycle';
import type { ListenerTest } from '@crossfire/agent-core/diagnostic';
import { wakePolicy } from '@crossfire/contracts/wake';

type Destination = ReturnType<typeof paths>;
export type LocalListener = { release: string; binding: string; session: string; ready: boolean; test?: ListenerTest };

export function reportStartup(message: { ready: true } | { error: string }): void {
  if (process.connected) process.send?.(message, () => {});
}

export async function localListener(destination: Destination, action: 'status' | 'stop' | 'test'): Promise<LocalListener | null> {
  const file = join(destination.state, 'listener.json');
  if (!existsSync(file)) return null;
  const record = fields(readJson<unknown>(file), ['port', 'secret']);
  if (!record.ok || typeof record.value.port !== 'number' || !Number.isInteger(record.value.port) || record.value.port < 1 || record.value.port > 65535
    || typeof record.value.secret !== 'string' || !/^[a-f0-9]{64}$/u.test(record.value.secret)) throw new Error('Invalid project listener control record');
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:' + record.value.port + '/control', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + record.value.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(action === 'stop' ? 20_000 : action === 'test' ? 35_000 : 3000) });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ECONNREFUSED') return null;
    throw new Error('Cannot contact the project listener; no replacement was started', { cause: error });
  }
  if (!response.body) throw new Error('Project listener control rejected the request');
  let body = '';
  for await (const part of response.body) { body += Buffer.from(part).toString('utf8'); if (Buffer.byteLength(body) > 4096) throw new Error('Invalid listener control size'); }
  if (response.status !== 200) {
    const failure = fields(JSON.parse(body || '{}') as unknown, ['error']);
    throw new Error(failure.ok && typeof failure.value.error === 'string' ? failure.value.error : 'Project listener control rejected the request');
  }
  const status = fields(JSON.parse(body) as unknown, ['release', 'binding', 'session', 'ready'], ['test']);
  if (!status.ok || !releaseName(status.value.release) || typeof status.value.binding !== 'string' || typeof status.value.session !== 'string' || typeof status.value.ready !== 'boolean') throw new Error('Invalid project listener status');
  if (action === 'test') {
    const result = fields(status.value.test, ['session', 'server', 'authenticated', 'rooms', 'joinedRooms', 'canReceiveRoomTasks', 'wakeMode', 'busy', 'deliveryPaused', 'approval', 'currentRelease', 'message']);
    if (!result.ok || result.value.session !== status.value.session || result.value.authenticated !== true || !Number.isSafeInteger(result.value.rooms)
      || Number(result.value.rooms) < 0 || !Number.isSafeInteger(result.value.joinedRooms) || Number(result.value.joinedRooms) < 0
      || typeof result.value.canReceiveRoomTasks !== 'boolean' || !wakePolicy(result.value.wakeMode) || typeof result.value.busy !== 'boolean' || typeof result.value.deliveryPaused !== 'boolean'
      || !['none', 'runtime', 'listener'].includes(String(result.value.approval))
      || typeof result.value.server !== 'string' || !releaseName(result.value.currentRelease) || typeof result.value.message !== 'string') throw new Error('Invalid live listener test result');
  }
  if (action === 'stop') {
    const released = await acquireProcessLock(join(destination.state, 'receiver'), 35);
    await released();
  }
  return status.value as LocalListener;
}

export async function startListener(destination: Destination, file: string, profile: string): Promise<void> {
  const available = await acquireProcessLock(join(destination.state, 'receiver'), 35);
  await available();
  privateDir(destination.state);
  const log = openSync(join(destination.state, 'listener.log'), 'a', 0o600);
  const child = spawn(process.execPath, [file, '--project', destination.workspace, '--profile', profile, 'agent', 'listen'], {
    cwd: destination.workspace, env: process.env, detached: true, stdio: ['ignore', log, log, 'ipc'],
  });
  closeSync(log);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Listener startup timed out; inspect the private project listener.log')), 60_000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once('error', finish);
      child.once('exit', () => finish(new Error('Listener could not start; inspect ' + join(destination.state, 'listener.log'))));
      child.once('message', message => {
        if (message && typeof message === 'object' && 'ready' in message && message.ready === true) finish();
        else if (message && typeof message === 'object' && 'error' in message && typeof message.error === 'string') finish(new Error(message.error));
        else finish(new Error('Invalid listener startup acknowledgement'));
      });
    });
    child.disconnect();
    child.unref();
  } catch (error) { child.kill('SIGTERM'); throw error; }
}

export async function runListener(destination: Destination, options: ListenerOptions, runtime: { binding: string; session: string; name: string }): Promise<void> {
  const { session } = runtime;
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Listener disconnected'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  try {
    await listen({ ...options, ready: () => {
      emit({ runtime: runtime.name, session, workspace: destination.workspace }); reportStartup({ ready: true }); } }, controller.signal);
  } catch (error) { if (!controller.signal.aborted && !isListenerStop(error)) throw error; }
  finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(signal, stop);
  }
}
