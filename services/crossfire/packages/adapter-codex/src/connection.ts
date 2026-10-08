import { realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConnection, RuntimeHooks, TurnControl, InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';
import { connectSession, type CodexOptions, type CodexSession } from './session.js';
import type { NativeEvent } from './protocol.js';
import { codexInput, type HistoryBoundary, type CodexInput } from './input.js';
import { nativeDelivery } from '@ctlflow/crossfire-adapter-runtime/delivery';

export type { CodexOptions } from './session.js';
export type CodexConnection = RuntimeConnection & { turnControl: TurnControl; verify: () => Promise<void>;
  inspectSession: (sessionId: string) => Promise<{ busy: boolean }>; unsettled: () => boolean; event: (event: NativeEvent) => void };

function pollInterval(milliseconds: number): number {
  if (!Number.isInteger(milliseconds) || milliseconds < 100 || milliseconds > 30_000) throw new Error('Codex receipt poll interval must be 100..30000 ms');
  return milliseconds;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex protocol response');
  return value as Record<string, unknown>;
}

export function codexDelivery(session: CodexSession, options: { pollMs: number; timeoutMs: number; receiptFile: string }): CodexConnection {
  const { sessionId, request } = session;
  const pollMs = pollInterval(options.pollMs), timeoutMs = options.timeoutMs;
  const failure = { signal: session.signal };
  let revision = 0, checkedRevision = 0, unavailable = 0;
  let wake: (() => void) | undefined;
  async function nativeState(threadId: string, scope?: AbortSignal): Promise<'idle' | 'active' | 'notLoaded'> {
    scope?.throwIfAborted();
    const response = object(await request('thread/read', { threadId, includeTurns: false }, scope));
    const thread = object(response.thread);
    const status = object(thread.status);
    if (thread.id !== threadId || !['idle', 'active', 'notLoaded'].includes(String(status.type))
        || thread.canAcceptDirectInput !== (status.type === 'notLoaded' ? null : true)) {
      throw new Error('The selected native session is not loaded for direct input; delivery stopped.');
    }
    if (typeof thread.cwd !== 'string' || realpathSync(thread.cwd) !== realpathSync(session.workspace)) {
      throw new Error('The Codex thread workspace differs from this Crossfire identity; refusing delivery');
    }
    return status.type as 'idle' | 'active' | 'notLoaded';
  }

  async function verify(scope?: AbortSignal): Promise<void> {
    if (await nativeState(sessionId, scope) === 'notLoaded') throw new Error('The selected native session is not loaded for direct input; delivery stopped.');
  }

  async function latestTurn(scope?: AbortSignal) {
    const result = object(await request('thread/turns/list', {
      threadId: sessionId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
    }, scope));
    if (!Array.isArray(result.data) || result.data.length > 1) throw new Error('Invalid Codex turn page');
    if (!result.data.length) return null;
    const turn = object(result.data[0]);
    if (typeof turn.id !== 'string' || !turn.id || !['inProgress', 'completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error('Invalid Codex turn identity or status');
    }
    return { id: turn.id, status: String(turn.status) };
  }

  async function activeTurn(_room?: string, admission?: InputAdmission): Promise<string | null> {
    const scope = admission?.signal;
    await verify(scope);
    let turn: Awaited<ReturnType<typeof latestTurn>>;
    try { turn = await latestTurn(scope); }
    catch (error) {
      if (unmaterialized(error) && await nativeState(sessionId, scope) === 'idle') return null;
      throw error;
    }
    return turn?.status === 'inProgress' ? turn.id : null;
  }

  async function turnStatus(turnId: string, scope?: AbortSignal): Promise<string> {
    let cursor: string | undefined;
    const visited = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const result = object(await request('thread/turns/list', {
        threadId: sessionId, limit: 100, sortDirection: 'desc', itemsView: 'notLoaded', ...(cursor ? { cursor } : {}),
      }, scope));
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

  async function interrupt(turnId: string, recovery = false, admission?: InputAdmission): Promise<'interrupted' | 'inactive'> {
    const scope = admission ? AbortSignal.any([failure.signal, admission.signal]) : failure.signal;
    await verify(scope);
    const status = await turnStatus(turnId, scope);
    if (status !== 'inProgress') return status === 'interrupted' ? 'interrupted' : 'inactive';
    if (recovery) throw new Error('Previous cancellation is uncertain and the captured turn is still active; inspect it before restarting the listener');
    try { await request('turn/interrupt', { threadId: sessionId, turnId }, scope); }
    catch (error) { scope.throwIfAborted(); if (await turnStatus(turnId, scope) === 'inProgress') throw error; }
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const status = await turnStatus(turnId, scope);
      if (status !== 'inProgress') return status === 'interrupted' ? 'interrupted' : 'inactive';
      if (performance.now() >= deadline) throw new Error('Codex cancellation remains uncertain; refusing replacement input');
      await delay(Math.min(pollMs, 100), undefined, { signal: scope });
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

  async function historyPage(limit: number, cursor?: string, scope?: AbortSignal) {
    const result = object(await request('thread/timeline/list', {
      threadId: sessionId, limit, ...(cursor ? { cursor } : {}),
    }, scope));
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

  function unmaterialized(error: unknown): boolean {
    return protocolError(error, -32600) && error.detail === `thread ${sessionId} is not materialized yet; thread/turns/list is unavailable before first user message`;
  }

  async function historyBoundary(scope?: AbortSignal): Promise<{ boundary: HistoryBoundary | null; initializing: boolean }> {
    try { return { boundary: (await historyPage(1, undefined, scope)).entries[0]?.boundary ?? null, initializing: false }; }
    catch (error) {
      if (!protocolError(error, -32601)) throw error;
      try { await latestTurn(scope); }
      catch (state) {
        if (unmaterialized(state)) {
          return { boundary: null, initializing: true };
        }
        throw error;
      }
      throw error;
    }
  }

  async function receipt(turnId: string | null, text: string, messageId: string, boundary: HistoryBoundary | null, scope: AbortSignal): Promise<{
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
      const result = await historyPage(100, cursor, scope);
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
          if (turnId !== null && entry.turnId !== turnId) throw new Error('Codex input receipt belongs to a different turn');
          return { status: 'received', boundary: newest };
        }
        if (turnId === null || entry.turnId !== turnId) continue;
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

  async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (revision !== checkedRevision) return;
    await new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timer); signal.removeEventListener('abort', finish); wake = undefined; resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      wake = finish;
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted || revision !== checkedRevision) finish();
    });
    signal.throwIfAborted();
  }

  const delivery = nativeDelivery<CodexInput>({ sessionId, approval: session.approval, signal: session.signal, verify,
    inspect: async () => ({ busy: await activeTurn() !== null || await nativeState(sessionId) === 'active' }), wait,
    prepare: async (text, messageId, scope) => {
      unavailable = 0;
      return { turn: null, text, messageId, ...await historyBoundary(scope) };
    },
    publish: async (input, retain) => {
      const result = object(await request('turn/start', {
        threadId: sessionId, clientUserMessageId: input.messageId,
        input: [{ type: 'text', text: input.text, text_elements: [] }],
      }));
      const turn = object(result.turn);
      if (typeof turn.id !== 'string' || !turn.id) throw new Error('Codex did not acknowledge a turn; delivery may be uncertain');
      retain({ ...input, turn: turn.id });
    },
    received: async (input, retain, scope) => {
      checkedRevision = revision;
      let checked: Awaited<ReturnType<typeof receipt>>;
      try { checked = await receipt(input.turn, input.text, input.messageId, input.boundary, scope); }
      catch (error) {
        if (!input.initializing || !protocolError(error, -32601) || ++unavailable >= 3) throw error;
        return false;
      }
      if (checked.status === 'received') return true;
      if (input.turn === null) throw new Error('Native input publication is uncertain; retained delivery journal prevents resubmission');
      if (input.initializing || checked.boundary?.key !== input.boundary?.key) retain({ ...input, initializing: false, boundary: checked.boundary });
      if (checked.status === 'unavailable') {
        if (++unavailable >= 3) throw new Error('Codex did not retain the accepted turn; read positions were not advanced');
        return false;
      }
      unavailable = 0;
      if (checked.status === 'interrupted') return 'interrupted';
      if (checked.status === 'missing') throw new Error('Codex finished without recording the input; read positions were not advanced');
      return 'waiting';
    },
    close: () => session.close(),
  }, codexInput, { journal: options.receiptFile, pollMs, timeoutMs });
  return { ...delivery, verify, inspectSession: async threadId => ({ busy: await nativeState(threadId) === 'active' }), turnControl: { activeTurn, interrupt },
    event: message => {
      if (message.params.threadId !== sessionId) return;
      if (message.method === 'thread/closed') throw new Error('The selected Codex thread closed; listener delivery stopped');
      if (message.method === 'thread/status/changed') {
        if (delivery.unsettled() && !['idle', 'active'].includes(String(object(message.params.status).type))) {
          throw new Error('The selected Codex thread is no longer available for input');
        }
        revision++; wake?.();
      }
    },
  };
}

export async function connectCodex(options: CodexOptions & { hooks: RuntimeHooks }, stop: AbortSignal): Promise<CodexConnection> {
  const pollMs = pollInterval(options.pollMs ?? 10_000);
  let delivery: CodexConnection | undefined;
  const session = await connectSession(options, stop, options.hooks, event => delivery?.event(event));
  try {
    delivery = codexDelivery(session, { pollMs, timeoutMs: options.timeoutMs ?? 30_000, receiptFile: options.receiptFile });
    await delivery.verify();
    return delivery;
  } catch (error) { if (delivery) await delivery.close(); else await session.close(); throw error; }
}
