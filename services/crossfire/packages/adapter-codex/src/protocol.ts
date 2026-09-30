import WebSocket from 'ws';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export type NativeRequest = { id: number | string; method: string; params: Record<string, unknown> };
export type NativeEvent = { method: string; params: Record<string, unknown> };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex protocol object');
  return value as Record<string, unknown>;
}

export function localEndpoint(value: string): string {
  if (value.startsWith('unix://')) {
    const requested = value.slice(7);
    if (!isAbsolute(requested) || requested.includes('\0')) throw new Error('Codex requires an exact private Unix socket path');
    const path = realpathSync(requested);
    const socket = lstatSync(path), directory = lstatSync(dirname(path));
    if (!socket.isSocket() || socket.uid !== process.getuid!() || socket.mode & 0o077
      || !directory.isDirectory() || directory.uid !== process.getuid!() || directory.mode & 0o077) throw new Error('Codex socket must be private and owned by the current user');
    return 'unix://' + path;
  }
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Codex requires an explicit loopback WebSocket endpoint without URL credentials');
  }
  return url.href;
}

export function codexProtocol(options: { endpoint: string; token: string; timeoutMs: number;
  event: (event: NativeEvent) => void; approval: (request: NativeRequest, signal: AbortSignal) => Promise<unknown> }, stop: AbortSignal) {
  stop.throwIfAborted();
  const endpoint = localEndpoint(options.endpoint);
  const unix = endpoint.startsWith('unix://');
  if (!unix && !options.token || options.token.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(options.token)) throw new Error('Supply a private Codex bearer token');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 300_000) throw new Error('Invalid native request deadline');
  const socket = new WebSocket(unix ? 'ws+unix://' + endpoint.slice(7) + ':/rpc' : endpoint, { headers: unix ? {} : { Authorization: 'Bearer ' + options.token },
    perMessageDeflate: false, maxPayload: MAX_FRAME_BYTES, handshakeTimeout: options.timeoutMs, followRedirects: false });
  const failure = new AbortController();
  const pending = new Map<number, Pending>();
  const approvals = new Set<number | string>();
  let sequence = 0;
  let closing = false;
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', () => reject(new Error('Codex WebSocket connection failed')));
    socket.once('close', () => reject(new Error('Codex WebSocket disconnected')));
  });
  const closed = new Promise<void>(resolve => socket.once('close', () => {
    stop.removeEventListener('abort', onAbort);
    if (!closing) fail(new Error('Codex WebSocket disconnected; listener stopped'));
    resolve();
  }));
  function fail(error: Error): void {
    if (!failure.signal.aborted) failure.abort(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    if (closing) return;
    closing = true;
    socket.terminate();
  }
  function onAbort(): void { fail(stop.reason instanceof Error ? stop.reason : new Error('Listener stopped')); }
  stop.addEventListener('abort', onAbort, { once: true });
  socket.on('error', () => fail(new Error('Codex WebSocket connection failed')));
  void ready.catch(fail);
  function write(message: unknown): void {
    failure.signal.throwIfAborted();
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES || socket.bufferedAmount > MAX_FRAME_BYTES) throw new Error('Codex request exceeds the native frame budget');
    socket.send(encoded, error => { if (error) fail(new Error('Codex WebSocket write failed')); });
  }
  function receive(value: unknown): void {
    const message = object(value);
    if (typeof message.method === 'string') {
      const params = object(message.params);
      if (!('id' in message)) { options.event({ method: message.method, params }); return; }
      if ((typeof message.id !== 'string' && !Number.isSafeInteger(message.id)) || approvals.size >= 16) throw new Error('Invalid or excessive native approval requests');
      const id = message.id as string | number;
      if (approvals.has(id)) throw new Error('Duplicate native approval identity');
      approvals.add(id);
      void options.approval({ id, method: message.method, params }, failure.signal).then(result => {
        if (!failure.signal.aborted) write({ id, result });
      }).catch(error => fail(error instanceof Error ? error : new Error('Native approval failed'))).finally(() => approvals.delete(id));
      return;
    }
    if (!Number.isSafeInteger(message.id)) throw new Error('Invalid Codex response identity');
    const request = pending.get(message.id as number);
    if (!request) throw new Error('Unexpected Codex response identity');
    if ('error' in message) {
      const error = object(message.error);
      if (!Number.isInteger(error.code) || typeof error.message !== 'string') throw new Error('Invalid Codex protocol error');
      pending.delete(message.id as number); clearTimeout(request.timer);
      request.reject(Object.assign(new Error('Codex request failed: ' + error.message), { code: error.code, detail: error.message }));
    } else if ('result' in message) {
      pending.delete(message.id as number); clearTimeout(request.timer); request.resolve(message.result);
    } else throw new Error('Codex response has neither result nor error');
  }
  socket.on('message', (data, binary) => {
    try {
      if (binary) throw new Error('Expected native Codex text JSON');
      receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data as Buffer)));
    } catch (error) { fail(error instanceof Error ? error : new Error('Invalid Codex WebSocket frame')); }
  });
  function request(method: string, params: unknown): Promise<unknown> {
    if (failure.signal.aborted) return Promise.reject(failure.signal.reason);
    if (pending.size >= 64) return Promise.reject(new Error('Too many pending native Codex requests'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Codex ' + method + ' timed out; delivery may be uncertain. Read positions were not advanced.')), options.timeoutMs);
      pending.set(id, { resolve, reject, timer });
      void ready.then(() => write({ id, method, params })).catch(error => fail(error instanceof Error ? error : new Error('Native request failed')));
    });
  }
  return { signal: failure.signal, request, notify: (method: string) => write({ method }),
    close: () => fail(new Error('Codex connection closed')), closed };
}
