import { existsSync } from 'node:fs';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { deliveryJournalExists, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import type { RuntimeHooks, InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import type { NativeActivity, NativeContextActivity } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { openSession } from './session.js';
import { codexDelivery, type CodexConnection } from './connection.js';
import { contextState, contextReceipt } from './context-state.js';
import { codexInput } from './input.js';
import { applyNativeInstructions } from './instructions.js';

export function codexHistories(options: { home: string; workspace: string; name: string; instructions: string; config: Record<string, unknown>;
  hooks: RuntimeHooks; mode: 'shared' | 'per-room'; endpoint: string; token: string; attachment: Omit<RuntimeAttachment, 'sessionId'>; allowNewHistory?: boolean }, signal: AbortSignal) {
  const { file, state } = contextState(options.home);
  const retained = (context: string) => state.bindings.find(binding => binding.context === context)?.sessionId;
  const contexts = () => state.bindings.map(binding => binding.context);
  const primary = options.mode === 'shared' ? retained('shared') : retained('control');
  const changingMode = existsSync(file) && state.mode !== options.mode && (state.mode === 'shared' ? retained('shared') : retained('control'));
  if (!primary && !changingMode && (!options.allowNewHistory || existsSync(file))) {
    throw Object.assign(new Error('Saved native history is missing. Resume cannot create a new history; use the explicit fresh-history operation if intended.'), { code: 'missing' });
  }
  const opened = new Map<string, CodexConnection>();
  const initializing = new Map<string, Promise<CodexConnection>>();
  const failed = new AbortController();
  const lifetime = AbortSignal.any([signal, failed.signal]);
  function receiptFile(context: string): string { return contextReceipt(options.home, context); }
  function retainedSession(context: string): string | null | undefined {
    return opened.get(context)?.sessionId ?? retained(context);
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
    for (const context of [...new Set(['shared', 'control', ...contexts()])]) {
      if (unacknowledged(context)) throw new Error('Resolve and acknowledge native publication before changing history mode');
    }
  }
  async function open(context: string, admission?: InputAdmission): Promise<CodexConnection> {
    admission?.signal.throwIfAborted();
    if (opened.has(context)) return opened.get(context)!;
    if (initializing.has(context)) {
      if (admission) throw Object.assign(new Error('Exact room history is opening; immediate input has not been accepted'), { code: 'unavailable' });
      return initializing.get(context)!;
    }
    const starting = new AbortController();
    const cancelled = () => starting.abort(admission?.signal.reason);
    admission?.signal.addEventListener('abort', cancelled, { once: true });
    const pending = (async () => {
      const previous = retained(context);
      if (!previous && context !== 'shared' && context !== 'control' && state.bindings.filter(binding => binding.context !== 'shared' && binding.context !== 'control').length >= 2000) throw new Error('Native room history budget is exhausted');
      let connection: CodexConnection | undefined;
      const session = await openSession({ workspace: options.workspace, endpoint: options.endpoint, token: options.token }, previous
        ? { kind: 'resume', id: previous, config: options.config }
        : { kind: 'create', name: options.name + (context === 'shared' ? '' : ' · ' + context), config: options.config }, AbortSignal.any([lifetime, starting.signal]),
        { ...options.hooks, observe: event => options.hooks.observe?.(event.kind === 'state'
          ? { ...event, observation: { ...event.observation, roomId: context === 'shared' || context === 'control' ? null : context } } : event) },
        event => connection?.event(event));
      try {
        if (!previous && [...state.bindings.map(binding => binding.sessionId), ...[...opened.values()].map(connection => connection.sessionId)]
          .includes(session.sessionId)) throw new Error('The native runtime reused another history identity');
        if (!previous) state.bindings.push({ context, sessionId: session.sessionId });
        state.mode = options.mode; writeJson(file, state);
        await applyNativeInstructions(session, { home: options.home, journal: receiptFile(context) + '.instructions', text: options.instructions });
        connection = codexDelivery(session, { pollMs: 1000, timeoutMs: 30000, receiptFile: receiptFile(context), observe: options.hooks.observe });
        await connection.verify();
        const ended = () => failed.abort(session.signal.reason);
        session.signal.addEventListener('abort', ended, { once: true });
        if (session.signal.aborted) ended();
        opened.set(context, connection); return connection;
      } catch (error) { if (connection) await connection.close(); else await session.close(); throw error; }
    })();
    initializing.set(context, pending);
    try { return await pending; } finally { initializing.delete(context); admission?.signal.removeEventListener('abort', cancelled); }
  }
  return { open, signal: lifetime,
    async activity(): Promise<NativeActivity> {
      lifetime.throwIfAborted();
      if (initializing.size) return { busy: true, contexts: [] };
      const count = opened.size;
      const inspector = opened.values().next().value;
      if (!inspector) throw new Error('Native activity cannot be inspected without an owned live native connection');
      const activity: NativeContextActivity[] = [];
      for (const context of [...new Set(['shared', 'control', ...contexts()])]) {
        const connection = opened.get(context);
        const sessionId = retainedSession(context);
        if (!sessionId) continue;
        let busy: boolean;
        if (connection) {
          busy = connection.unsettled() || (await connection.inspect()).busy;
        } else {
          busy = unacknowledged(context) || (await inspector.inspectSession(sessionId)).busy;
        }
        activity.push({ context, sessionId, busy });
      }
      if (initializing.size || opened.size !== count) return { busy: true, contexts: [] };
      for (const item of activity) item.busy ||= opened.get(item.context)?.unsettled() === true;
      return { busy: options.hooks.pendingDecisions?.() === true || activity.some(item => item.busy), contexts: activity };
    },
    async close() {
      failed.abort(new Error('Native history owner stopped')); await Promise.allSettled([...initializing.values()]);
      const results = await Promise.allSettled([...opened.values()].map(connection => connection.close()));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
      if (errors.length) throw new AggregateError(errors, 'Native history cleanup did not complete');
    },
    async settle(cancelled?: AbortSignal) {
      for (const context of [...new Set(['shared', 'control', ...contexts()])]) {
        if (!opened.has(context) && unacknowledged(context)) await open(context);
      }
      let received = false; for (const connection of opened.values()) received = await connection.settle(cancelled) || received; return received;
    },
    acknowledge(ids: readonly string[]) { for (const connection of opened.values()) connection.acknowledge(ids); },
    async attachments() { return [...new Set(['shared', 'control', ...contexts()])].flatMap(context => {
      const sessionId = retainedSession(context);
      return sessionId ? [{ context, attachment: { ...options.attachment, sessionId } }] : [];
    }); },
    async activeTurn(room?: string, admission?: InputAdmission) {
      const context = options.mode === 'shared' ? 'shared' : room ?? 'control';
      const connection = admission ? await open(context, admission) : opened.get(context);
      admission?.signal.throwIfAborted();
      const turn = connection ? await connection.turnControl.activeTurn(undefined, admission) : null;
      return turn ? JSON.stringify([context, turn]) : null;
    },
    async interrupt(turn: string, recovery?: boolean, admission?: InputAdmission) {
      admission?.signal.throwIfAborted();
      const parsed: unknown = JSON.parse(turn);
      if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(value => typeof value === 'string')) throw new Error('Invalid captured history and turn');
      if (!retained(parsed[0] as string)
        && !opened.has(parsed[0] as string)) throw new Error('Captured native history does not exist');
      const connection = await open(parsed[0] as string, admission);
      return connection.turnControl.interrupt(parsed[1] as string, recovery, admission);
    },
  };
}
