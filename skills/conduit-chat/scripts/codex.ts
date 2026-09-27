import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type HistoryBoundary = { position: number; key: string };
type Delivery = { turn: string; text: string; messageId: string; boundary: HistoryBoundary | null };
export type CodexOptions = { thread: string; workspace: string; binary?: string; socket?: string; timeoutMs?: number; pollMs?: number };
export type CodexConnection = {
  signal: AbortSignal;
  verify: () => Promise<void>;
  deliver: (text: string, messageId: string, cancelled?: AbortSignal) => Promise<void>;
  settle: () => Promise<boolean>;
  activeTurn: () => Promise<string | null>;
  interrupt: (turnId: string, recovery?: boolean) => Promise<void>;
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
  const pollMs = options.pollMs ?? 10_000;
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 30_000) throw new Error('Codex receipt poll interval must be 100..30000 ms');
  signal.throwIfAborted();
  const args = ['app-server', 'proxy', ...(options.socket ? ['--sock', options.socket] : [])];
  const child = spawn(options.binary ?? 'codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const failure = new AbortController();
  const pending = new Map<number, Pending>();
  const timeoutMs = options.timeoutMs ?? 30_000;
  let nextId = 0;
  let stderr = '';
  let closing = false;
  let receiveDelivery: ((message: Record<string, unknown>) => void) | undefined;
  let pendingDelivery: Delivery | undefined;
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
      if (typeof message.method === 'string') {
        if (!('id' in message)) receiveDelivery?.(message);
        return;
      }
      if (typeof message.id !== 'number') throw new Error('Invalid Codex response ID');
      const request = pending.get(message.id);
      if (!request) throw new Error('Unexpected Codex response ID');
      if ('error' in message) {
        const error = object(message.error);
        request.reject(Object.assign(new Error(`Codex request failed: ${String(error.message ?? 'unknown protocol error')}`), { code: error.code }));
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

  async function latestTurn() {
    const result = object(await request('thread/turns/list', {
      threadId: options.thread, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
    }));
    if (!Array.isArray(result.data) || result.data.length > 1) throw new Error('Invalid Codex turn page');
    if (!result.data.length) return null;
    const turn = object(result.data[0]);
    if (typeof turn.id !== 'string' || !turn.id || !['inProgress', 'completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error('Invalid Codex turn identity or status');
    }
    return { id: turn.id, status: String(turn.status) };
  }

  async function activeTurn(): Promise<string | null> {
    await verify();
    const turn = await latestTurn();
    return turn?.status === 'inProgress' ? turn.id : null;
  }

  async function turnStatus(turnId: string): Promise<string> {
    let cursor: string | undefined;
    const visited = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const result = object(await request('thread/turns/list', {
        threadId: options.thread, limit: 100, sortDirection: 'desc', itemsView: 'notLoaded', ...(cursor ? { cursor } : {}),
      }));
      if (!Array.isArray(result.data) || result.data.length > 100) throw new Error('Invalid Codex turn page');
      for (const value of result.data) {
        const turn = object(value);
        if (turn.id !== turnId) continue;
        if (!['inProgress', 'completed', 'interrupted', 'failed'].includes(String(turn.status))) throw new Error('Invalid Codex turn status');
        return String(turn.status);
      }
      if (result.nextCursor === null) break;
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || !result.data.length || visited.has(result.nextCursor)) throw new Error('Invalid Codex turn cursor');
      cursor = result.nextCursor;
      visited.add(cursor);
    }
    throw new Error('Cannot prove the captured Codex turn status; refusing replacement input');
  }

  async function interrupt(turnId: string, recovery = false): Promise<void> {
    await verify();
    if (await turnStatus(turnId) !== 'inProgress') return;
    if (recovery) throw new Error('Previous cancellation is uncertain and the captured turn is still active; inspect it before restarting the listener');
    try { await request('turn/interrupt', { threadId: options.thread, turnId }); }
    catch (error) { if (await turnStatus(turnId) === 'inProgress') throw error; }
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      if (await turnStatus(turnId) !== 'inProgress') return;
      if (performance.now() >= deadline) throw new Error('Codex cancellation remains uncertain; refusing replacement input');
      await delay(Math.min(pollMs, 100), undefined, { signal: failure.signal });
    }
  }

  function isReceipt(value: unknown, text: string, messageId: string): boolean {
    const item = object(value);
    if (typeof item.type !== 'string') throw new Error('Invalid Codex item');
    if (item.type !== 'userMessage' || item.clientId !== messageId) return false;
    if (typeof item.id !== 'string' || !item.id || !Array.isArray(item.content) || item.content.length !== 1) {
      throw new Error('Invalid Codex input receipt');
    }
    const content = object(item.content[0]);
    if (content.type !== 'text' || content.text !== text) throw new Error('Codex input receipt differs from the submitted message');
    return true;
  }

  async function historyPage(limit: number, cursor?: string) {
    const result = object(await request('thread/timeline/list', {
      threadId: options.thread, limit, ...(cursor ? { cursor } : {}),
    }));
    if (!Array.isArray(result.data) || result.data.length > limit) throw new Error('Invalid Codex input history page');
    if (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !result.nextCursor || !result.data.length)) {
      throw new Error('Invalid Codex input history cursor');
    }
    const entries = result.data.toReversed().map(value => {
      const entry = object(value);
      if (typeof entry.position !== 'number' || !Number.isSafeInteger(entry.position) || entry.position < 0) {
        throw new Error('Invalid Codex input history position');
      }
      if (!['item', 'realtime', 'turnStarted', 'turnCompleted'].includes(String(entry.type))) {
        throw new Error('Invalid Codex turn history entry');
      }
      if (entry.type !== 'realtime' && (typeof entry.turnId !== 'string' || !entry.turnId)) {
        throw new Error('Invalid Codex turn history identity');
      }
      let itemId: string | undefined;
      if (entry.type === 'item' || entry.type === 'realtime') {
        const item = object(entry.item);
        if (typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') throw new Error('Invalid Codex history item');
        itemId = item.id;
      }
      if (entry.type === 'turnCompleted' && !['completed', 'interrupted', 'failed'].includes(String(entry.status))) {
        throw new Error('Invalid Codex turn completion');
      }
      return { entry, boundary: { position: entry.position, key: JSON.stringify([entry.position, entry.type, entry.turnId, itemId]) } };
    });
    return { entries, nextCursor: result.nextCursor as string | null };
  }

  async function historyBoundary(): Promise<HistoryBoundary | null> {
    try { return (await historyPage(1)).entries[0]?.boundary ?? null; }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === -32601) return null;
      throw error;
    }
  }

  async function receipt(turnId: string, text: string, messageId: string, boundary: HistoryBoundary | null): Promise<{
    status: 'received' | 'pending' | 'interrupted' | 'missing' | 'unavailable'; boundary: HistoryBoundary | null;
  }> {
    let cursor: string | undefined;
    const visited = new Set<string>();
    const seen = new Set<string>();
    let completion: 'interrupted' | 'missing' | undefined;
    let started = false;
    let newest = boundary;
    let position = Infinity;
    for (let page = 0; page < 100; page++) {
      const result = await historyPage(100, cursor);
      if (page === 0) newest = result.entries[0]?.boundary ?? null;
      for (const value of result.entries) {
        if (value.boundary.position > position || seen.has(value.boundary.key)) {
          throw new Error('Invalid Codex input history order');
        }
        position = value.boundary.position;
        seen.add(value.boundary.key);
      }
      for (const value of result.entries) {
        const { entry } = value;
        if (boundary && value.boundary.key === boundary.key) return { status: completion ?? 'pending', boundary: newest };
        if (boundary && value.boundary.position < boundary.position) throw new Error('Codex input history lost its verification boundary');
        if (entry.type === 'item' && isReceipt(entry.item, text, messageId)) {
          if (entry.turnId !== turnId) throw new Error('Codex input receipt belongs to a different turn');
          return { status: 'received', boundary: newest };
        }
        if (entry.turnId !== turnId) continue;
        if (entry.type === 'turnCompleted') {
          completion = entry.status === 'interrupted' ? 'interrupted' : 'missing';
        } else if (entry.type === 'turnStarted') started = true;
      }
      if (result.nextCursor === null) {
        if (boundary) throw new Error('Codex input history lost its verification boundary');
        if (!started) return { status: 'unavailable', boundary: null };
        return { status: completion ?? 'pending', boundary: newest };
      }
      if (visited.has(result.nextCursor)) throw new Error('Invalid Codex input history cursor');
      cursor = result.nextCursor;
      visited.add(cursor);
    }
    throw new Error('Codex input history exceeds the verification bound; read positions were not advanced');
  }

  async function waitForReceipt(delivery: Delivery, deliverySignal: AbortSignal): Promise<boolean> {
    if (receiveDelivery) throw new Error('Codex input delivery must be sequential');
    let revision = 0;
    let wake: (() => void) | undefined;
    receiveDelivery = message => {
      if (message.method !== 'thread/status/changed') return;
      const params = object(message.params);
      if (params.threadId !== options.thread) return;
      if (!['idle', 'active'].includes(String(object(params.status).type))) {
        throw new Error('The selected Codex thread is no longer available for input');
      }
      revision++;
      wake?.();
    };
    async function wait(previousRevision: number): Promise<void> {
      deliverySignal.throwIfAborted();
      if (revision !== previousRevision) return;
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timer);
          deliverySignal.removeEventListener('abort', finish);
          wake = undefined;
          resolve();
        };
        const timer = setTimeout(finish, pollMs);
        wake = finish;
        deliverySignal.addEventListener('abort', finish, { once: true });
      });
      deliverySignal.throwIfAborted();
    }
    try {
      let unavailable = 0;
      for (;;) {
        deliverySignal.throwIfAborted();
        const previousRevision = revision;
        let status: Awaited<ReturnType<typeof receipt>>['status'];
        try {
          const checked = await receipt(delivery.turn, delivery.text, delivery.messageId, delivery.boundary);
          status = checked.status;
          if (status === 'received') return true;
          delivery.boundary = checked.boundary;
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== -32601 || ++unavailable >= 3) throw error;
          await wait(revision);
          continue;
        }
        if (status === 'unavailable') {
          if (++unavailable >= 3) throw new Error('Codex did not retain the accepted turn; read positions were not advanced');
          await wait(revision);
          continue;
        }
        unavailable = 0;
        if (status === 'interrupted') return false;
        if (status === 'missing') throw new Error('Codex finished without recording the input; read positions were not advanced');
        await wait(previousRevision);
      }
    } finally {
      receiveDelivery = undefined;
      wake?.();
    }
  }

  async function settle(): Promise<boolean> {
    if (!pendingDelivery) return false;
    const received = await waitForReceipt(pendingDelivery, failure.signal);
    pendingDelivery = undefined;
    return received;
  }

  async function deliver(text: string, messageId: string, cancelled?: AbortSignal): Promise<void> {
    if (pendingDelivery || receiveDelivery) throw new Error('Codex input delivery must be sequential; settle the preceding delivery before submitting another');
    const deliverySignal = cancelled ? AbortSignal.any([failure.signal, cancelled]) : failure.signal;
    for (;;) {
      deliverySignal.throwIfAborted();
      await verify();
      const boundary = await historyBoundary();
      deliverySignal.throwIfAborted();
      const result = object(await request('turn/start', {
        threadId: options.thread, clientUserMessageId: messageId,
        input: [{ type: 'text', text, text_elements: [] }],
      }));
      const turn = object(result.turn);
      if (typeof turn.id !== 'string' || !turn.id) throw new Error('Codex did not acknowledge a turn; delivery may be uncertain');
      pendingDelivery = { turn: turn.id, text, messageId, boundary };
      const received = await waitForReceipt(pendingDelivery, deliverySignal);
      pendingDelivery = undefined;
      if (received) return;
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
    return { signal: failure.signal, verify, close, deliver, settle, activeTurn, interrupt };
  } catch (error) {
    close();
    throw error;
  }
}
