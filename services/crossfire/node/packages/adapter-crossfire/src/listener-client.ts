import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { collect } from '@ctlflow/crossfire-adapter-matrix/http';
import { fields } from '@ctlflow/crossfire-contracts/validation';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';
import { listenerRecord, listenerStatus, historyResult, type ListenerRequest, type LocalListener, type HistoryResult } from './listener-protocol.js';
export type { LocalListener } from './listener-protocol.js';

export function listenerRequest(state: string, input: Extract<ListenerRequest, { action: 'read' }>): Promise<Result<Extract<HistoryResult, { text: string }>> | null>;
export function listenerRequest(state: string, input: Extract<ListenerRequest, { action: 'acknowledge' }>): Promise<Result<Extract<HistoryResult, { accepted: true }>> | null>;
export function listenerRequest(state: string, input: Extract<ListenerRequest, { action: 'status' | 'stop' | 'test' }>): Promise<Result<LocalListener> | null>;
export async function listenerRequest(state: string, input: ListenerRequest): Promise<Result<LocalListener | HistoryResult> | null> {
  const file = join(state, 'listener.json');
  if (!existsSync(file)) return null;
  const record = listenerRecord(readJson<unknown>(file));
  if (!record.ok) return record;
  try {
    const response = await fetch('http://127.0.0.1:' + record.value.port + '/bindings/' + record.value.binding + '/control', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + record.value.secret, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      signal: AbortSignal.timeout(input.action === 'status' ? 3000 : 45000) });
    if (!response.body) return failure('unavailable', 'Listener returned no control response');
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await collect(response.body, 1024 * 1024)));
    if (input.action === 'read' || input.action === 'acknowledge') return historyResult(parsed, input.action);
    if (response.status !== 200) {
      const error = fields(parsed, ['error']);
      return failure('unavailable', error.ok && typeof error.value.error === 'string' ? error.value.error : 'Listener rejected the control request');
    }
    const result = listenerStatus(parsed, input.action);
    return result.ok && result.value.binding !== record.value.binding ? failure('invalid', 'Listener response belongs to a different binding') : result;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ECONNREFUSED') return null;
    return failure('unavailable', 'Cannot contact the owning listener; no replacement receiver was started');
  }
}
