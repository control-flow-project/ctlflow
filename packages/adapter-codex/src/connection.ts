import { realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConnection, RuntimeHooks } from '../../agent-core/src/runtime.js';
import { connectSession, type CodexOptions, type CodexSession } from './session.js';
import type { NativeEvent } from './protocol.js';

export type { CodexOptions } from './session.js';
export type CodexConnection = RuntimeConnection & { verify: () => Promise<void>; event: (event: NativeEvent) => void };
type HistoryBoundary = { position: number; key: string };
type Delivery = { turn: string; text: string; messageId: string; boundary: HistoryBoundary | null; initializing: boolean };

function pollInterval(milliseconds: number): number {
  if (!Number.isInteger(milliseconds) || milliseconds < 100 || milliseconds > 30_000) throw new Error('Codex receipt poll interval must be 100..30000 ms');
  return milliseconds;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex protocol response');
  return value as Record<string, unknown>;
}

export function codexDelivery(session: CodexSession, options: { pollMs: number; timeoutMs: number }): CodexConnection {
  const { sessionId, request } = session;
  const pollMs = pollInterval(options.pollMs), timeoutMs = options.timeoutMs;
  const failure = { signal: session.signal };
  let receiveDelivery: ((message: NativeEvent) => void) | undefined;
  let pendingDelivery: Delivery | undefined;
  async function verify(): Promise<void> {
    const response = object(await request('thread/read', { threadId: sessionId, includeTurns: false }));
    const thread = object(response.thread);
    const status = object(thread.status);
    if (thread.id !== sessionId || thread.canAcceptDirectInput !== true
        || !['idle', 'active'].includes(String(status.type))) {
      throw new Error('The selected native session is not loaded for direct input; delivery stopped.');
    }
    if (typeof thread.cwd !== 'string' || realpathSync(thread.cwd) !== realpathSync(session.workspace)) {
      throw new Error('The Codex thread workspace differs from this Crossfire identity; refusing delivery');
    }
  }

  async function latestTurn() {
    const result = object(await request('thread/turns/list', {
      threadId: sessionId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
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
        threadId: sessionId, limit: 100, sortDirection: 'desc', itemsView: 'notLoaded', ...(cursor ? { cursor } : {}),
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
    try { await request('turn/interrupt', { threadId: sessionId, turnId }); }
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
      threadId: sessionId, limit, ...(cursor ? { cursor } : {}),
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

  function protocolError(error: unknown, code: number): error is Error & { code: number; detail: string } {
    return error instanceof Error && 'code' in error && error.code === code
      && 'detail' in error && typeof error.detail === 'string';
  }

  async function historyBoundary(): Promise<{ boundary: HistoryBoundary | null; initializing: boolean }> {
    try { return { boundary: (await historyPage(1)).entries[0]?.boundary ?? null, initializing: false }; }
    catch (error) {
      if (!protocolError(error, -32601)) throw error;
      try { await latestTurn(); }
      catch (state) {
        if (protocolError(state, -32600) && state.detail === `thread ${sessionId} is not materialized yet; thread/turns/list is unavailable before first user message`) {
          return { boundary: null, initializing: true };
        }
        throw error;
      }
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
      if (params.threadId !== sessionId) return;
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
        let checked: Awaited<ReturnType<typeof receipt>>;
        try { checked = await receipt(delivery.turn, delivery.text, delivery.messageId, delivery.boundary); }
        catch (error) {
          if (!delivery.initializing || !protocolError(error, -32601) || ++unavailable >= 3) throw error;
          await wait(previousRevision);
          continue;
        }
        delivery.initializing = false;
        status = checked.status;
        if (status === 'received') return true;
        delivery.boundary = checked.boundary;
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
      const history = await historyBoundary();
      deliverySignal.throwIfAborted();
      const result = object(await request('turn/start', {
        threadId: sessionId, clientUserMessageId: messageId,
        input: [{ type: 'text', text, text_elements: [] }],
      }));
      const turn = object(result.turn);
      if (typeof turn.id !== 'string' || !turn.id) throw new Error('Codex did not acknowledge a turn; delivery may be uncertain');
      pendingDelivery = { turn: turn.id, text, messageId, ...history };
      const received = await waitForReceipt(pendingDelivery, deliverySignal);
      pendingDelivery = undefined;
      if (received) return;
    }
  }

  return { sessionId, signal: session.signal, verify, close: session.close, deliver, settle, activeTurn, interrupt,
    event: message => {
      if (message.method === 'thread/closed' && message.params.threadId === sessionId) {
        throw new Error('The selected Codex thread closed; listener delivery stopped');
      }
      receiveDelivery?.(message);
    },
  };
}

export async function connectCodex(options: CodexOptions & { hooks: RuntimeHooks }, stop: AbortSignal): Promise<CodexConnection> {
  const pollMs = pollInterval(options.pollMs ?? 10_000);
  let delivery: CodexConnection | undefined;
  const session = await connectSession(options, stop, options.hooks, event => delivery?.event(event));
  try {
    delivery = codexDelivery(session, { pollMs, timeoutMs: options.timeoutMs ?? 30_000 });
    await delivery.verify();
    return delivery;
  } catch (error) { await session.close(); throw error; }
}
