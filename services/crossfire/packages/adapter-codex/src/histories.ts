import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as check from '@crossfire/contracts/schema/validation';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import type { RuntimeHooks } from '@crossfire/agent-core/runtime';
import type { RuntimeAttachment } from '@crossfire/agent-core/terminal';
import { success } from '@crossfire/kernel/result';
import { openSession } from './session.js';
import { codexDelivery, type CodexConnection } from './connection.js';

const contexts = check.object({ mode: check.choice('shared', 'per-room'), control: check.nullable(check.identifier),
  rooms: check.list(check.object({ room: check.roomId, sessionId: check.identifier }), 2000) });
export function codexHistories(options: { home: string; workspace: string; name: string; instructions: string; config: Record<string, unknown>;
  hooks: RuntimeHooks; mode: 'shared' | 'per-room'; endpoint: string; token: string; attachment: Omit<RuntimeAttachment, 'sessionId'>; allowNewHistory?: boolean }, signal: AbortSignal) {
  const file = join(options.home, 'crossfire-contexts.json');
  const loaded = contexts(existsSync(file) ? readJson<unknown>(file) : { mode: 'shared', control: null, rooms: [] });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const state = loaded.value;
  const sharedFile = join(options.home, 'crossfire-session.json');
  const saved = existsSync(sharedFile) ? check.object({ sessionId: check.identifier })(readJson<unknown>(sharedFile)) : success(null);
  if (!saved.ok) throw new Error(saved.error.message);
  const sharedSessionId = saved.value?.sessionId;
  const primary = options.mode === 'shared' ? sharedSessionId : state.control;
  const changingMode = existsSync(file) && state.mode !== options.mode && (state.mode === 'shared' ? sharedSessionId : state.control);
  const sessions = [sharedSessionId, state.control, ...state.rooms.map(room => room.sessionId)].filter((id): id is string => id != null);
  if (new Set(state.rooms.map(room => room.room)).size !== state.rooms.length || new Set(sessions).size !== sessions.length) {
    throw new Error('Native history bindings require unique rooms and distinct session identities');
  }
  if (!primary && !changingMode && (!options.allowNewHistory || existsSync(file))) {
    throw Object.assign(new Error('Saved native history is missing. Resume cannot create a new history; use the explicit fresh-history operation if intended.'), { code: 'missing' });
  }
  const opened = new Map<string, CodexConnection>();
  const initializing = new Map<string, Promise<CodexConnection>>();
  const failed = new AbortController();
  const lifetime = AbortSignal.any([signal, failed.signal]);
  function receiptFile(context: string): string { return context === 'shared' ? sharedFile + '.receipt' : file + '.' + createHash('sha256').update(context).digest('hex') + '.receipt'; }
  if (state.mode !== options.mode) {
    if (options.hooks.pendingDecisions?.()) throw new Error('Resolve original native decisions before changing history mode');
    for (const context of ['shared', 'control', ...state.rooms.map(room => room.room)]) {
      const receipt = receiptFile(context);
      if (!existsSync(receipt)) continue;
      const journal = readJson<{ pending: unknown; confirmed: unknown[] }>(receipt, 32 * 1024 * 1024);
      if (journal.pending !== null || journal.confirmed.length) throw new Error('Resolve and acknowledge native publication before changing history mode');
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
        ? { kind: 'resume', id: previous, instructions: options.instructions, config: options.config }
        : { kind: 'create', name: options.name + (context === 'shared' ? '' : ' · ' + context), instructions: options.instructions, config: options.config }, lifetime,
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
        connection = codexDelivery(session, { pollMs: 1000, timeoutMs: 30000, receiptFile: receiptFile(context) });
        await connection.verify();
        const ended = () => failed.abort(session.signal.reason);
        session.signal.addEventListener('abort', ended, { once: true });
        if (session.signal.aborted) ended();
        opened.set(context, connection); return connection;
      } catch (error) { await session.close(); throw error; }
    })();
    initializing.set(context, pending);
    try { return await pending; } finally { initializing.delete(context); }
  }
  return { open, signal: lifetime,
    async close() { failed.abort(new Error('Native history owner stopped')); await Promise.allSettled([...initializing.values()]); await Promise.all([...opened.values()].map(connection => connection.close())); },
    async settle() {
      for (const context of ['shared', 'control', ...state.rooms.map(room => room.room)]) {
        const receipt = receiptFile(context);
        if (!opened.has(context) && existsSync(receipt)) {
          const journal = readJson<{ pending: unknown; confirmed: unknown[] }>(receipt, 32 * 1024 * 1024);
          if (journal.pending !== null || journal.confirmed.length) await open(context);
        }
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
