import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readJson, writeJson, privateDir } from '../../../packages/files/src/index.js';
import { fields } from '../../../packages/contracts/src/management.js';
import { releaseName } from '../../../packages/contracts/src/release.js';
import type { paths } from '../../../packages/agent-core/src/state.js';
import { acquireProcessLock, emit } from '../../../packages/agent-core/src/state.js';
import type { ListenerOptions } from '../../../packages/agent-core/src/listen.js';
import { listen } from '../../../packages/agent-core/src/listen.js';

type Destination = ReturnType<typeof paths>;
export type LocalListener = { release: string; binding: string; session: string; ready: boolean };

export function reportStartup(message: { ready: true } | { error: string }): void {
  if (process.connected) process.send?.(message, () => {});
}

export async function localListener(destination: Destination, action: 'status' | 'stop'): Promise<LocalListener | null> {
  const file = join(destination.state, 'listener.json');
  if (!existsSync(file)) return null;
  const record = fields(readJson<unknown>(file), ['port', 'secret']);
  if (!record.ok || typeof record.value.port !== 'number' || !Number.isInteger(record.value.port) || record.value.port < 1 || record.value.port > 65535
    || typeof record.value.secret !== 'string' || !/^[a-f0-9]{64}$/u.test(record.value.secret)) throw new Error('Invalid project listener control record');
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:' + record.value.port + '/control', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + record.value.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(action === 'stop' ? 20_000 : 3000) });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ECONNREFUSED') return null;
    throw new Error('Cannot contact the project listener; no replacement was started', { cause: error });
  }
  if (response.status !== 200 || !response.body) throw new Error('Project listener control rejected the request');
  let body = '';
  for await (const part of response.body) { body += Buffer.from(part).toString('utf8'); if (Buffer.byteLength(body) > 4096) throw new Error('Invalid listener control size'); }
  const status = fields(JSON.parse(body) as unknown, ['release', 'binding', 'session', 'ready']);
  if (!status.ok || !releaseName(status.value.release) || typeof status.value.binding !== 'string' || typeof status.value.session !== 'string' || typeof status.value.ready !== 'boolean') throw new Error('Invalid project listener status');
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
  const { binding, session } = runtime;
  const release = await acquireProcessLock(join(destination.state, 'receiver'));
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Listener disconnected'));
  const secret = randomBytes(32).toString('hex');
  const state: LocalListener = { release: options.release.release, binding, session, ready: false };
  let complete: () => void = () => {};
  const completed = new Promise<void>(resolve => { complete = resolve; });
  const server = createServer(async (request, response) => {
    response.setHeader('Connection', 'close');
    if (request.method !== 'POST' || request.url !== '/control' || request.headers.authorization !== 'Bearer ' + secret) { response.writeHead(403).end(); return; }
    try {
      let body = '';
      for await (const part of request) { body += String(part); if (body.length > 256) throw new Error('Control request too large'); }
      const input = fields(JSON.parse(body) as unknown, ['action']);
      if (!input.ok || !['status', 'stop'].includes(String(input.value.action))) throw new Error('Invalid control request');
      if (input.value.action === 'stop') { stop(); await completed; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(state));
    } catch { response.writeHead(400).end(); }
  });
  server.requestTimeout = 5000;
  const file = join(destination.state, 'listener.json');
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot open private listener control');
    writeJson(file, { port: address.port, secret });
    await listen({ ...options, ready: () => { state.ready = true;
      emit({ runtime: runtime.name, session, workspace: destination.workspace }); reportStartup({ ready: true }); } }, controller.signal);
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally {
    state.ready = false; complete();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (existsSync(file)) unlinkSync(file);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(signal, stop);
    await release();
  }
}
