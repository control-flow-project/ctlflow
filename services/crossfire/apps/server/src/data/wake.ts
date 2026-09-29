import { executeDelete, executeInsert, executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema, type Store } from './database.js';

export function wakeSenders(store: Store, agent: string): string[] {
  return executeSelect(store, schema, (query, params) => query.from('wake_senders')
    .where(row => row.agent === params.agent).orderBy(row => row.sender).select(row => row.sender).take(2000), { agent });
}

export function replaceWakeSenders(store: Store, agent: string, senders: readonly string[]): void {
  executeDelete(store, schema, (query, params) => query.deleteFrom('wake_senders').where(row => row.agent === params.agent), { agent });
  for (const sender of senders) executeInsert(store, schema, (query, params) => query.insertInto('wake_senders')
    .values({ agent: params.agent, sender: params.sender }), { agent, sender });
}
