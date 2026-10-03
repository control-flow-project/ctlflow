import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { fields } from '@crossfire/contracts/validation';
import { failure, type Result } from '@crossfire/kernel/result';
import { errorCode } from '@crossfire/contracts/rest/envelope';
import type { HistoryRequest } from '@crossfire/agent-core/history-query';

export async function listenerRequest(state: string, input: { action: 'read'; input: HistoryRequest } | { action: 'acknowledge'; queryId: string }): Promise<Result<{ queryId?: string | null; text?: string; accepted?: boolean }> | null> {
  const file = join(state, 'listener.json');
  if (!existsSync(file)) return null;
  const record = fields(readJson<unknown>(file), ['port', 'secret']);
  if (!record.ok || !Number.isInteger(record.value.port) || Number(record.value.port) < 1 || Number(record.value.port) > 65535
    || typeof record.value.secret !== 'string' || !/^[a-f0-9]{64}$/u.test(record.value.secret)) return failure('invalid', 'Invalid private listener control record');
  try {
    const response = await fetch('http://127.0.0.1:' + record.value.port + '/control', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + record.value.secret, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(45000) });
    if (!response.body) return failure('unavailable', 'Listener returned no query response');
    const parts: Uint8Array[] = []; let size = 0;
    for await (const part of response.body) { size += part.length; if (size > 1024 * 1024) return failure('invalid', 'Listener query response exceeds its resource limit'); parts.push(part); }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
    const result = fields(parsed, ['ok'], ['value', 'error']);
    if (!result.ok || typeof result.value.ok !== 'boolean') return failure('invalid', 'Invalid listener query response');
    if (!result.value.ok) {
      const error = fields(result.value.error, ['code', 'message']);
      const code = error.ok ? errorCode(error.value.code) : error;
      return error.ok && code.ok && typeof error.value.message === 'string'
        ? failure(code.value, error.value.message) : failure('unavailable', 'Listener query failed');
    }
    const value = fields(result.value.value, [], ['queryId', 'text', 'accepted']);
    if (!value.ok || input.action === 'read' && (typeof value.value.text !== 'string' || value.value.queryId !== null && typeof value.value.queryId !== 'string')
      || input.action === 'acknowledge' && value.value.accepted !== true) return failure('invalid', 'Invalid listener query result');
    return { ok: true, value: value.value as { queryId?: string | null; text?: string; accepted?: boolean } };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ECONNREFUSED') return null;
    return failure('unavailable', 'Cannot contact the owning listener; no replacement receiver was started');
  }
}
