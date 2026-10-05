import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { privateDir } from '@crossfire/adapter-filesystem/index';
import { listenerRequest, type LocalListener } from '@crossfire/adapter-crossfire/listener-client';
import type { paths } from '@crossfire/adapter-filesystem/project';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { emit } from './output.js';
import type { ListenerOptions } from '@crossfire/adapter-crossfire/listener';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { isListenerStop } from '@crossfire/kernel/lifecycle';

type Destination = ReturnType<typeof paths>;
export type { LocalListener } from '@crossfire/adapter-crossfire/listener-client';

export function reportStartup(message: { ready: true } | { error: string }): void {
  if (process.connected) process.send?.(message, () => {});
}

export async function localListener(destination: Destination, action: 'status' | 'stop' | 'test'): Promise<LocalListener | null> {
  const status = await listenerRequest(destination.state, { action });
  if (!status) return null;
  if (!status.ok) throw new Error(status.error.message);
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
