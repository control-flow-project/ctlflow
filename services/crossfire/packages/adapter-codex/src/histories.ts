import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { deliveryJournalExists, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import { openSession } from './session.js';
import { codexDelivery, type CodexConnection } from './connection.js';
import { contextState } from './context-state.js';
import { codexInput } from './input.js';
import { applyNativeInstructions } from './instructions.js';

export function codexHistories(options: { home: string; workspace: string; name: string; instructions: string; config: Record<string, unknown>;
  hooks: RuntimeHooks; mode: 'shared' | 'per-room'; endpoint: string; token: string; attachment: Omit<RuntimeAttachment, 'sessionId'>; allowNewHistory?: boolean }, signal: AbortSignal) {
  const { file, state, sharedFile, sharedSessionId } = contextState(options.home);
  const primary = options.mode === 'shared' ? sharedSessionId : state.control;
  const changingMode = existsSync(file) && state.mode !== options.mode && (state.mode === 'shared' ? sharedSessionId : state.control);
  if (!primary && !changingMode && (!options.allowNewHistory || existsSync(file))) {
    throw Object.assign(new Error('Saved native history is missing. Resume cannot create a new history; use the explicit fresh-history operation if intended.'), { code: 'missing' });
  }
  const opened = new Map<string, CodexConnection>();
  const initializing = new Map<string, Promise<CodexConnection>>();
  const failed = new AbortController();
  const lifetime = AbortSignal.any([signal, failed.signal]);
  function receiptFile(context: string): string { return context === 'shared' ? sharedFile + '.receipt' : file + '.' + createHash('sha256').update(context).digest('hex') + '.receipt'; }
  function retainedSession(context: string): string | null | undefined {
    return opened.get(context)?.sessionId ?? (context === 'shared' ? sharedSessionId : context === 'control' ? state.control : state.rooms.find(room => room.room === context)?.sessionId);
  }
  function unacknowledged(context: string): boolean {
    const receipt = receiptFile(context);
    if (!deliveryJournalExists(receipt)) return false;
    const sessionId = retainedSession(context);
    if (!sessionId) throw new Error('Native publication journal has no retained context identity');
    const journal = readDeliveryJournal(receipt, sessionId, codexInput);
    return journal.pending !== null || journal.confirmed.length > 0;
  }
  if (state.mode !== options.mode) {
    if (options.hooks.pendingDecisions?.()) throw new Error('Resolve original native decisions before changing history mode');
    for (const context of ['shared', 'control', ...state.rooms.map(room => room.room)]) {
      if (unacknowledged(context)) throw new Error('Resolve and acknowledge native publication before changing history mode');
    }
  }
  async function open(context: string): Promise<CodexConnection> {
    if (opened.has(context)) return opened.get(context)!;
    if (initializing.has(context)) return initializing.get(context)!;
    const pending = (async () => {
      const previous = context === 'shared' ? sharedSessionId : context === 'control' ? state.control : state.rooms.find(room => room.room === context)?.sessionId;
      if (!previous && context !== 'shared' && context !== 'control' && state.rooms.length >= 2000) throw new Error('Native room history budget is exhausted');
      let connection: CodexConnection | undefined;
      const session = await openSession({ workspace: options.workspace, endpoint: options.endpoint, token: options.token }, previous
        ? { kind: 'resume', id: previous, config: options.config }
        : { kind: 'create', name: options.name + (context === 'shared' ? '' : ' · ' + context), config: options.config }, lifetime,
        { ...options.hooks, observe: event => options.hooks.observe?.(event.kind === 'state'
          ? { ...event, observation: { ...event.observation, roomId: context === 'shared' || context === 'control' ? null : context } } : event) },
        event => connection?.event(event));
      try {
        if (!previous && [sharedSessionId, state.control, ...state.rooms.map(room => room.sessionId), ...[...opened.values()].map(connection => connection.sessionId)]
          .includes(session.sessionId)) throw new Error('The native runtime reused another history identity');
        if (context === 'shared') writeJson(sharedFile, { sessionId: session.sessionId });
        else if (context === 'control') state.control = session.sessionId;
        else if (!previous) state.rooms.push({ room: context, sessionId: session.sessionId });
        state.mode = options.mode; writeJson(file, state);
        await applyNativeInstructions(session, { home: options.home, journal: receiptFile(context) + '.instructions', text: options.instructions });
        connection = codexDelivery(session, { pollMs: 1000, timeoutMs: 30000, receiptFile: receiptFile(context) });
        await connection.verify();
        const ended = () => failed.abort(session.signal.reason);
        session.signal.addEventListener('abort', ended, { once: true });
        if (session.signal.aborted) ended();
        opened.set(context, connection); return connection;
      } catch (error) { if (connection) await connection.close(); else await session.close(); throw error; }
    })();
    initializing.set(context, pending);
    try { return await pending; } finally { initializing.delete(context); }
  }
  return { open, signal: lifetime,
    async inspect() {
      lifetime.throwIfAborted();
      if (initializing.size || options.hooks.pendingDecisions?.()) return { busy: true };
      const count = opened.size;
      const inspector = opened.values().next().value;
      if (!inspector) throw new Error('Native activity cannot be inspected without an owned live native connection');
      for (const context of ['shared', 'control', ...state.rooms.map(room => room.room)]) {
        const connection = opened.get(context);
        if (connection) {
          if (connection.unsettled() || (await connection.inspect()).busy) return { busy: true };
        } else {
          if (unacknowledged(context)) return { busy: true };
          const sessionId = retainedSession(context);
          if (sessionId && (await inspector.inspectSession(sessionId)).busy) return { busy: true };
        }
      }
      return { busy: initializing.size > 0 || opened.size !== count || options.hooks.pendingDecisions?.() === true
        || [...opened.values()].some(connection => connection.unsettled()) };
    },
    async close() {
      failed.abort(new Error('Native history owner stopped')); await Promise.allSettled([...initializing.values()]);
      const results = await Promise.allSettled([...opened.values()].map(connection => connection.close()));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
      if (errors.length) throw new AggregateError(errors, 'Native history cleanup did not complete');
    },
    async settle() {
      for (const context of ['shared', 'control', ...state.rooms.map(room => room.room)]) {
        if (!opened.has(context) && unacknowledged(context)) await open(context);
      }
      let received = false; for (const connection of opened.values()) received = await connection.settle() || received; return received;
    },
    acknowledge(ids: readonly string[]) { for (const connection of opened.values()) connection.acknowledge(ids); },
    async attachments() { return ['shared', 'control', ...state.rooms.map(room => room.room)].flatMap(context => {
      const sessionId = context === 'shared' ? opened.get(context)?.sessionId ?? sharedSessionId : context === 'control' ? state.control : state.rooms.find(room => room.room === context)?.sessionId;
      return sessionId ? [{ context, attachment: { ...options.attachment, sessionId } }] : [];
    }); },
    async activeTurn(room?: string) {
      const context = options.mode === 'shared' ? 'shared' : room ?? 'control';
      const connection = opened.get(context);
      const turn = connection ? await connection.turnControl.activeTurn() : null;
      return turn ? JSON.stringify([context, turn]) : null;
    },
    async interrupt(turn: string, recovery?: boolean) {
      const parsed: unknown = JSON.parse(turn);
      if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(value => typeof value === 'string')) throw new Error('Invalid captured history and turn');
      if (!(parsed[0] === 'shared' && sharedSessionId || parsed[0] === 'control' && state.control || state.rooms.some(room => room.room === parsed[0]))
        && !opened.has(parsed[0] as string)) throw new Error('Captured native history does not exist');
      const connection = await open(parsed[0] as string);
      await connection.turnControl.interrupt(parsed[1] as string, recovery);
    },
  };
}
