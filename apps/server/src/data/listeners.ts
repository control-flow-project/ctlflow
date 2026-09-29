import { executeInsert, executeSelect, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { schema, type Store, type Tables } from './database.js';

export function listener(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from('listeners').where(row => row.id === params.id).firstOrDefault(), { id });
}

export function liveListeners(store: Store, agent: string, since: number) {
  return executeSelect(store, schema, (query, params) => query.from('listeners')
    .where(row => row.agent === params.agent && row.lastSeen > params.since && row.stopped === 0).take(100), { agent, since });
}

export function listenerTotals(store: Store, agent: string) {
  const messages = executeSelect(store, schema, (query, params) => query.from('listeners')
    .where(row => row.agent === params.agent).sum(row => row.messages), { agent }) ?? 0;
  const activeMs = executeSelect(store, schema, (query, params) => query.from('listeners')
    .where(row => row.agent === params.agent).sum(row => row.activeMs), { agent }) ?? 0;
  const latest = executeSelect(store, schema, (query, params) => query.from('listeners')
    .where(row => row.agent === params.agent).orderByDescending(row => row.lastSeen).firstOrDefault(), { agent });
  return { messages, activeMs, lastSeen: latest?.lastSeen ?? null, lastRelease: latest?.release ?? null };
}

export function insertListener(store: Store, input: Tables['listeners']): void {
  executeInsert(store, schema, (query, params) => query.insertInto('listeners').values({
    id: params.id, agent: params.agent, release: params.release, started: params.started, lastSeen: params.lastSeen,
    activeMs: params.activeMs, messages: params.messages, stopped: params.stopped, disconnect: params.disconnect,
  }), input);
}

export function updateListener(store: Store, input: Tables['listeners']): void {
  executeUpdate(store, schema, (query, params) => query.update('listeners').set({
    lastSeen: params.lastSeen, activeMs: params.activeMs, messages: params.messages, stopped: params.stopped,
  }).where(row => row.id === params.id && row.agent === params.agent), input);
}

export function disconnectListeners(store: Store, agent: string, since: number) {
  return executeUpdate(store, schema, (query, params) => query.update('listeners').set({ disconnect: 1 })
    .where(row => row.agent === params.agent && row.lastSeen > params.since && row.stopped === 0), { agent, since });
}
