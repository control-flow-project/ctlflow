import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writePrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { piEnvironment } from './home.js';
import { piVersion } from './options.js';
import { piExtensionSource } from './extension.js';
import { failureError } from '@ctlflow/crossfire-kernel/result';
import { piErrorText } from './errors.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failureError({ code: 'invalid', message: 'Invalid native Pi object' });
  return value as Record<string, unknown>;
}
export async function startPi(input: { binary: string; workspace: string; stateDirectory: string; home: string; profile: string;
  sessionFile: string; instructions: string; event: (event: Record<string, unknown>) => void }, stop: AbortSignal) {
  stop.throwIfAborted();
  const environment = piEnvironment(input.home, input.stateDirectory, input.profile);
  const version = await new Promise<string>((resolve, reject) => {
    execFile(input.binary, ['--version'], { cwd: input.workspace, env: environment, timeout: 10000, maxBuffer: 4096, encoding: 'utf8', signal: stop }, (error, output) => {
      if (error) reject(new Error('Cannot run Pi --version; install @earendil-works/pi-coding-agent 1.0.0'));
      else resolve(output.trim());
    });
  });
  const supported = piVersion(version);
  if (!supported.ok) throw failureError(supported.error);
  const extension = join(input.home, 'crossfire-extension.mjs'), instructions = join(input.home, 'crossfire-instructions.txt');
  writePrivateBytes(extension, Buffer.from(piExtensionSource()), 1024 * 1024);
  writePrivateBytes(instructions, Buffer.from(input.instructions), 8 * 1024 * 1024);
  const child = spawn(input.binary, ['--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
    '--no-approve', '--session', input.sessionFile, '--append-system-prompt', instructions, '--extension', extension],
  { cwd: input.workspace, env: environment, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const failed = new AbortController(), lifetime = AbortSignal.any([stop, failed.signal]);
  const requests = new Map<string, { command: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const controls = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let buffered = '', closing: Promise<void> | undefined;
  let finish!: () => void;
  const ended = new Promise<void>(resolve => { finish = resolve; });
  child.once('error', () => failed.abort(new Error('Owned Pi process could not start')));
  child.once('close', () => { failed.abort(new Error('Owned Pi process exited')); finish(); });
  function terminate(signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) throw error; }
  }
  async function close(): Promise<void> {
    return closing ??= Promise.resolve().then(async () => {
      failed.abort(new Error('Owned Pi connection closed'));
      let rejectEscalation!: (error: unknown) => void;
      const escalation = new Promise<never>((_resolve, reject) => { rejectEscalation = reject; });
      const timer = setTimeout(() => { try { terminate('SIGKILL'); } catch (error) { rejectEscalation(error); } }, 3000);
      try { terminate('SIGTERM'); await Promise.race([ended, escalation]); } finally { clearTimeout(timer); lifetime.removeEventListener('abort', aborted); }
    });
  }
  function aborted(): void {
    for (const request of [...requests.values(), ...controls.values()]) request.reject(lifetime.reason);
    requests.clear(); controls.clear(); void close().catch(error => { failed.abort(error); });
  }
  lifetime.addEventListener('abort', aborted, { once: true });
  child.stdin.on('error', () => failed.abort(new Error('Owned Pi input pipe closed')));
  child.stdout.on('data', (bytes: Buffer) => {
    try {
      buffered += decoder.decode(bytes, { stream: true });
      if (Buffer.byteLength(buffered) > 32 * 1024 * 1024) throw failureError({ code: 'limit', message: 'Native Pi protocol frame exceeds its finite byte budget' });
      for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
        if (!line) continue;
        const event = record(JSON.parse(line) as unknown);
        if (event.type === 'response') {
          if (typeof event.id !== 'string') throw failureError({ code: 'invalid', message: 'Uncorrelated native Pi response' });
          const request = requests.get(event.id);
          if (!request) continue;
          if (event.command !== request.command || typeof event.success !== 'boolean') throw failureError({ code: 'invalid', message: 'Mismatched native Pi response' });
          requests.delete(event.id);
          if (event.success) request.resolve(event.data);
          else request.reject(new Error(piErrorText('Pi ' + request.command + ' failed: ' + String(event.error))));
        } else if (event.type === 'extension_ui_request' && event.method === 'notify' && typeof event.message === 'string' && event.message.startsWith('{"crossfire":true,')) {
          const value = record(JSON.parse(event.message) as unknown);
          const request = typeof value.id === 'string' ? controls.get(value.id) : undefined;
          if (!request) continue;
          controls.delete(value.id as string); request.resolve(value.data);
        } else if (event.type === 'extension_ui_request' && event.method === 'notify' && typeof event.message === 'string' && event.message.startsWith('{"crossfireEvent":"interruption",')) {
          const value = record(JSON.parse(event.message) as unknown);
          if (typeof value.turn !== 'string') throw failureError({ code: 'invalid', message: 'Invalid native captured interruption event' });
          input.event({ type: 'interruption_started', turn: value.turn });
        } else { input.event(event); }
      }
    } catch (error) { failed.abort(error instanceof SyntaxError ? failureError({ code: 'invalid', message: 'Native Pi emitted invalid JSON' }) : error); }
  });
  child.stderr.on('data', () => {});
  function notify(value: Record<string, unknown>): Promise<void> {
    lifetime.throwIfAborted();
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Native Pi command exceeds its finite byte budget');
    return new Promise<void>((resolve, reject) => { child.stdin.write(text, error => error ? reject(error) : resolve()); });
  }
  async function pending(map: Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>, id: string, write: () => Promise<void>, signal: AbortSignal, command?: string): Promise<unknown> {
    const scope = AbortSignal.any([lifetime, signal]); scope.throwIfAborted();
    let cancel!: () => void, timer: ReturnType<typeof setTimeout>;
    return new Promise<unknown>((resolve, reject) => {
      map.set(id, { ...(command ? { command } : {}), resolve, reject });
      cancel = () => reject(scope.reason);
      scope.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => reject(new Error('Native Pi command timed out')), 30000);
      void write().catch(reject);
    }).finally(() => { clearTimeout(timer); map.delete(id); scope.removeEventListener('abort', cancel); });
  }
  async function request(command: string, parameters: Record<string, unknown> = {}, signal = lifetime): Promise<unknown> {
    const id = randomUUID();
    return pending(requests, id, () => notify({ ...parameters, type: command, id }), signal, command);
  }
  async function control(operation: string, parameters: Record<string, unknown> = {}, signal = lifetime): Promise<unknown> {
    const id = randomUUID();
    return pending(controls, id, async () => { await request('prompt', { message: '/crossfire-control ' + Buffer.from(JSON.stringify({ ...parameters, id, operation })).toString('base64url') }, signal); }, signal);
  }
  if (lifetime.aborted) aborted();
  return { signal: lifetime, version, request, control, notify, close, fail: (error: unknown) => failed.abort(error), pid: child.pid };
}
export type PiProcess = Awaited<ReturnType<typeof startPi>>;
