import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import WebSocket from 'ws';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export type CodexOptions = { thread: string; workspace: string; binary?: string; socket?: string; timeoutMs?: number };
export type CodexConnection = {
  signal: AbortSignal;
  verify: () => Promise<void>;
  deliver: (text: string, messageId: string) => Promise<void>;
  close: () => void;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex protocol response');
  return value as Record<string, unknown>;
}

export async function connectCodex(options: CodexOptions, signal: AbortSignal): Promise<CodexConnection> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.thread)) {
    throw new Error('Supply the exact Codex thread UUID with --thread');
  }
  if (options.socket && !isAbsolute(options.socket)) throw new Error('--codex-socket must be an absolute path');
  signal.throwIfAborted();
  const args = ['app-server', 'proxy', ...(options.socket ? ['--sock', options.socket] : [])];
  const child = spawn(options.binary ?? 'codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const failure = new AbortController();
  const pending = new Map<number, Pending>();
  const timeoutMs = options.timeoutMs ?? 30_000;
  let nextId = 0;
  let stderr = '';
  let closing = false;
  const pipes = { readable: child.stdout, writable: child.stdin };
  const fromStreams = Duplex.from as typeof Duplex.from & ((streams: typeof pipes) => Duplex);
  const tunnel = fromStreams(pipes);
  const socket = new WebSocket('ws://localhost/', {
    createConnection: () => tunnel as Socket,
    perMessageDeflate: false, maxPayload: 8 * 1024 * 1024,
  });

  function stop(error: Error): void {
    if (failure.signal.aborted) return;
    failure.abort(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    socket.terminate();
    tunnel.destroy();
    if (child.exitCode === null) child.kill('SIGTERM');
  }

  function onAbort(): void {
    stop(signal.reason instanceof Error ? signal.reason : new Error('Codex connection cancelled'));
  }
  signal.addEventListener('abort', onAbort, { once: true });
  child.stdin.on('error', error => stop(error));
  tunnel.on('error', error => stop(error));
  child.on('error', error => stop(new Error(`Cannot connect to the running Codex app server: ${error.message}`)));
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4096); });
  child.on('close', () => {
    signal.removeEventListener('abort', onAbort);
    if (!closing) stop(new Error(`Codex proxy disconnected. Open this session through the shared app server first.${stderr ? '\n' + stderr.trim() : ''}`));
  });
  socket.on('error', error => stop(error));
  socket.on('close', () => { if (!closing) stop(new Error('Codex control connection closed; pending delivery may be uncertain')); });
  socket.on('message', (data, binary) => {
    try {
      if (binary) throw new Error('Expected a text Codex protocol response');
      const message = object(JSON.parse(data.toString()));
      if (typeof message.method === 'string') return;
      if (typeof message.id !== 'number') throw new Error('Invalid Codex response ID');
      const request = pending.get(message.id);
      if (!request) throw new Error('Unexpected Codex response ID');
      if ('error' in message) {
        const error = object(message.error);
        request.reject(new Error(`Codex rejected input: ${String(error.message ?? 'unknown protocol error')}`));
      } else if ('result' in message) request.resolve(message.result);
      else request.reject(new Error('Codex response has neither result nor error'));
      pending.delete(message.id);
      clearTimeout(request.timer);
    } catch (error) { stop(error instanceof Error ? error : new Error('Invalid Codex response')); }
  });

  function request(method: string, params: unknown): Promise<unknown> {
    if (failure.signal.aborted) return Promise.reject(failure.signal.reason);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error(`Codex ${method} timed out; delivery may be uncertain. Read positions were not advanced.`)), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }), error => { if (error) stop(error); });
    });
  }

  async function verify(): Promise<void> {
    const response = object(await request('thread/read', { threadId: options.thread, includeTurns: false }));
    const thread = object(response.thread);
    const status = object(thread.status);
    if (thread.id !== options.thread || thread.canAcceptDirectInput !== true
        || !['idle', 'active'].includes(String(status.type))) {
      throw new Error('The selected thread is not loaded for direct input. Open that exact session in the shared Codex app server; Crossfire will not resume or start it.');
    }
    if (typeof thread.cwd !== 'string' || realpathSync(thread.cwd) !== realpathSync(options.workspace)) {
      throw new Error('The Codex thread workspace differs from this Crossfire identity; refusing delivery');
    }
  }

  function close(): void {
    closing = true;
    signal.removeEventListener('abort', onAbort);
    stop(new Error('Codex connection closed'));
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error('Codex control handshake timed out')), timeoutMs);
      function finished(): void {
        clearTimeout(timer);
        failure.signal.removeEventListener('abort', failed);
        socket.removeListener('open', opened);
      }
      function failed(): void { finished(); reject(failure.signal.reason); }
      function opened(): void { finished(); resolve(); }
      socket.once('open', opened);
      failure.signal.addEventListener('abort', failed, { once: true });
      if (failure.signal.aborted) failed();
    });
    await request('initialize', { clientInfo: { name: 'crossfire', title: 'Crossfire chat input', version: '0.1.0' },
      capabilities: { experimentalApi: true } });
    socket.send(JSON.stringify({ method: 'initialized' }));
    await verify();
    return {
      signal: failure.signal, verify, close,
      deliver: async (text, messageId) => {
        await verify();
        const result = object(await request('turn/start', {
          threadId: options.thread, clientUserMessageId: messageId,
          input: [{ type: 'text', text, text_elements: [] }],
        }));
        const turn = object(result.turn);
        if (typeof turn.id !== 'string' || !turn.id) throw new Error('Codex did not acknowledge a turn; delivery may be uncertain');
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
