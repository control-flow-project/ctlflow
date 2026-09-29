import { executeInsert, executeSelect, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { schema, type Store, type Tables } from './database.js';

export function notice(store: Store, agent: string, sender: string) {
  return executeSelect(store, schema, (query, params) => query.from('blocked_notices')
    .where(row => row.agent === params.agent && row.sender === params.sender).firstOrDefault(), { agent, sender });
}

export function reserveNotice(store: Store, input: Tables['blocked_notices']): void {
  const previous = notice(store, input.agent, input.sender);
  if (previous) executeUpdate(store, schema, (query, params) => query.update('blocked_notices')
    .set({ event: params.event, room: params.room, reserved: params.reserved, content: params.content, sent: 0 })
    .where(row => row.agent === params.agent && row.sender === params.sender), input);
  else executeInsert(store, schema, (query, params) => query.insertInto('blocked_notices').values({
    agent: params.agent, sender: params.sender, event: params.event, room: params.room,
    reserved: params.reserved, content: params.content, sent: 0,
  }), input);
}

export function noticeCount(store: Store, agent: string): number {
  return executeSelect(store, schema, (query, params) => query.from('blocked_notices').where(row => row.agent === params.agent).count(), { agent });
}

export function completeNotice(store: Store, agent: string, sender: string, event: string): void {
  executeUpdate(store, schema, (query, params) => query.update('blocked_notices').set({ sent: 1 })
    .where(row => row.agent === params.agent && row.sender === params.sender && row.event === params.event), { agent, sender, event });
}
