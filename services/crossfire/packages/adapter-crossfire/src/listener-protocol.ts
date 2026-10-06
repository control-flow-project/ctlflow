import { fields } from '@ctlflow/crossfire-contracts/validation';
import { releaseName } from '@ctlflow/crossfire-contracts/release';
import { wakePolicy } from '@ctlflow/crossfire-contracts/wake';
import { errorCode } from '@ctlflow/crossfire-contracts/rest/envelope';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { historyRequest, type HistoryRequest } from '@ctlflow/crossfire-agent-core/history-query';
import type { ListenerTest } from '@ctlflow/crossfire-agent-core/diagnostic';

export type LocalListener = { release: string; binding: string; session: string; ready: boolean; test?: ListenerTest };
export type ListenerRequest = { action: 'status' | 'stop' | 'test' }
  | { action: 'read'; input: HistoryRequest } | { action: 'acknowledge'; queryId: string };
export type HistoryResult = { queryId: string | null; text: string } | { accepted: true };
export type ListenerRecord = { port: number; secret: string; binding: string };

export function listenerRecord(input: unknown): Result<ListenerRecord> {
  const record = fields(input, ['port', 'secret', 'binding']);
  if (!record.ok || typeof record.value.port !== 'number' || !Number.isInteger(record.value.port)
    || record.value.port < 1 || record.value.port > 65535 || typeof record.value.secret !== 'string'
    || !/^[a-f0-9]{64}$/u.test(record.value.secret) || typeof record.value.binding !== 'string'
    || !/^[a-zA-Z0-9._-]{1,255}$/u.test(record.value.binding)) return failure('invalid', 'Invalid private listener control record');
  return success({ port: record.value.port, secret: record.value.secret, binding: record.value.binding });
}

export function listenerInput(input: unknown): Result<ListenerRequest> {
  const value = fields(input, ['action'], ['input', 'queryId']);
  if (!value.ok) return value;
  const action = value.value.action;
  const allowed = action === 'read' ? ['action', 'input'] : action === 'acknowledge' ? ['action', 'queryId'] : ['action'];
  if (Object.keys(value.value).some(key => !allowed.includes(key))) return failure('invalid', 'Unknown listener action fields');
  if (action === 'read') {
    const parsed = historyRequest(value.value.input);
    return parsed.ok ? success({ action, input: parsed.value }) : parsed;
  }
  if (action === 'acknowledge') return typeof value.value.queryId === 'string' && value.value.queryId.length <= 255
    ? success({ action, queryId: value.value.queryId }) : failure('invalid', 'Invalid history acknowledgment');
  return action === 'status' || action === 'stop' || action === 'test' ? success({ action }) : failure('invalid', 'Invalid listener action');
}

export function listenerStatus(input: unknown, action: 'status' | 'stop' | 'test'): Result<LocalListener> {
  const status = fields(input, ['release', 'binding', 'session', 'ready'], ['test']);
  if (!status.ok || !releaseName(status.value.release) || typeof status.value.binding !== 'string'
    || typeof status.value.session !== 'string' || typeof status.value.ready !== 'boolean') return failure('invalid', 'Invalid listener status');
  if (action === 'test') {
    const result = fields(status.value.test, ['session', 'server', 'authenticated', 'rooms', 'joinedRooms', 'canReceiveRoomTasks', 'wakeMode', 'busy', 'deliveryPaused', 'approval', 'currentRelease', 'message']);
    if (!result.ok || result.value.session !== status.value.session || result.value.authenticated !== true || !Number.isSafeInteger(result.value.rooms)
      || Number(result.value.rooms) < 0 || !Number.isSafeInteger(result.value.joinedRooms) || Number(result.value.joinedRooms) < 0
      || typeof result.value.canReceiveRoomTasks !== 'boolean' || !wakePolicy(result.value.wakeMode) || typeof result.value.busy !== 'boolean'
      || typeof result.value.deliveryPaused !== 'boolean' || !['none', 'runtime', 'listener'].includes(String(result.value.approval))
      || typeof result.value.server !== 'string' || !releaseName(result.value.currentRelease) || typeof result.value.message !== 'string') return failure('invalid', 'Invalid live listener test result');
  }
  return success(status.value as LocalListener);
}

export function historyResult(input: unknown, action: 'read' | 'acknowledge'): Result<HistoryResult> {
  const result = fields(input, ['ok'], ['value', 'error']);
  if (!result.ok || typeof result.value.ok !== 'boolean') return failure('invalid', 'Invalid listener query response');
  if (!result.value.ok) {
    const error = fields(result.value.error, ['code', 'message']);
    const code = error.ok ? errorCode(error.value.code) : error;
    return error.ok && code.ok && typeof error.value.message === 'string'
      ? failure(code.value, error.value.message) : failure('invalid', 'Invalid listener query failure');
  }
  if (action === 'read') {
    const value = fields(result.value.value, ['queryId', 'text']);
    if (!value.ok || typeof value.value.text !== 'string' || value.value.queryId !== null && typeof value.value.queryId !== 'string') return failure('invalid', 'Invalid history query result');
    return success({ queryId: value.value.queryId, text: value.value.text });
  }
  const value = fields(result.value.value, ['accepted']);
  return value.ok && value.value.accepted === true ? success({ accepted: true }) : failure('invalid', 'Invalid history acknowledgment result');
}
