import * as check from './validation.js';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { pagination, listQuery } from './request.js';
export type PageQuery = { page: number; pageSize: number };
function checked(input: unknown, allowed: readonly string[]): Result<URLSearchParams> { return listQuery(['page', 'pageSize', ...allowed])(input); }
export function page(input: unknown) {
  const parsed = checked(input, []);
  return parsed.ok ? pagination(parsed.value) : parsed;
}
export function runtimeDecisions(input: unknown): Result<PageQuery & { status: 'pending' | null }> {
  const parsed = checked(input, ['status']); if (!parsed.ok) return parsed;
  const bounds = pagination(parsed.value); if (!bounds.ok) return bounds;
  const status = parsed.value.get('status');
  if (status === null) return success({ ...bounds.value, status: null });
  return status === 'pending' ? success({ ...bounds.value, status: 'pending' as const }) : failure('invalid', 'Invalid native decision status filter');
}
export function roomGrants(input: unknown): Result<PageQuery & { roomIds?: string[] }> {
  const parsed = checked(input, ['roomIds']);
  if (!parsed.ok) return parsed;
  const bounds = pagination(parsed.value);
  if (!bounds.ok) return bounds;
  const source = parsed.value.get('roomIds');
  if (source === null) return bounds;
  if (new TextEncoder().encode(source).length > 16384) return failure('invalid', 'Room filter exceeds its size bound');
  let decoded: unknown;
  try { decoded = JSON.parse(source); } catch { return failure('invalid', 'roomIds must be a JSON array'); }
  const roomIds = check.list(check.roomId, 100)(decoded);
  if (!roomIds.ok) return roomIds;
  if (new Set(roomIds.value).size !== roomIds.value.length) return failure('invalid', 'Duplicate room filter');
  return success({ ...bounds.value, roomIds: roomIds.value });
}
export function scoped(input: unknown) {
  const parsed = checked(input, ['ownerId']);
  if (!parsed.ok) return parsed;
  const bounds = pagination(parsed.value);
  if (!bounds.ok) return bounds;
  const ownerId = parsed.value.get('ownerId');
  if (ownerId === null) return success(bounds.value);
  const valid = check.identifier(ownerId);
  return valid.ok ? success({ ...bounds.value, ownerId }) : valid;
}
export function agents(input: unknown) {
  const parsed = checked(input, ['ownerId', 'status', 'listener', 'search']);
  if (!parsed.ok) return parsed;
  const params = parsed.value;
  const bounds = pagination(params), ownerId = params.get('ownerId'), search = params.get('search') ?? '';
  if (!bounds.ok) return bounds;
  if (ownerId !== null) { const valid = check.identifier(ownerId); if (!valid.ok) return valid; }
  const statuses: ('active' | 'suspended' | 'revoked')[] = [];
  const selection = params.get('status') ?? 'active,suspended';
  for (const value of selection === '' ? [] : selection.split(',')) {
    const parsedStatus = check.status(value);
    if (!parsedStatus.ok) return parsedStatus;
    if (statuses.includes(parsedStatus.value)) return failure('invalid', 'Duplicate account status');
    statuses.push(parsedStatus.value);
  }
  const listener = check.choice('all', 'online', 'offline', 'disconnecting')(params.get('listener') ?? 'all');
  if (!listener.ok) return listener;
  if (!check.text(200, 0)(search).ok) return failure('invalid', 'Invalid search');
  return success({ ...bounds.value, statuses, search, listener: listener.value, ...(ownerId === null ? {} : { ownerId }) });
}
export function fleets(input: unknown) {
  const parsed = checked(input, ['ownerId', 'search']); if (!parsed.ok) return parsed;
  const params = new URLSearchParams(parsed.value), search = params.get('search') ?? ''; params.delete('search');
  if (!check.text(200, 0)(search).ok) return failure('invalid', 'Invalid search');
  const scope = scoped(params);
  return scope.ok ? success({ ...scope.value, search }) : scope;
}
export function principals(input: unknown) {
  const parsed = checked(input, ['kind', 'search', 'excludeId']);
  if (!parsed.ok) return parsed;
  const bounds = pagination(parsed.value), kind = check.choice('all', 'human', 'agent')(parsed.value.get('kind') ?? 'all');
  if (!bounds.ok) return bounds; if (!kind.ok) return kind;
  const search = parsed.value.get('search') ?? '', excludeId = parsed.value.get('excludeId');
  if (!check.text(200, 0)(search).ok) return failure('invalid', 'Invalid search');
  if (excludeId !== null) { const valid = check.identifier(excludeId); if (!valid.ok) return valid; }
  return success({ ...bounds.value, kind: kind.value, search, ...(excludeId === null ? {} : { excludeId }) });
}
export function rooms(input: unknown) {
  const parsed = checked(input, ['agentId', 'search']);
  if (!parsed.ok) return parsed;
  const bounds = pagination(parsed.value);
  if (!bounds.ok) return bounds;
  const agentId = parsed.value.get('agentId'), search = parsed.value.get('search') ?? '';
  if (!check.text(200, 0)(search).ok) return failure('invalid', 'Invalid search');
  if (agentId !== null) { const valid = check.identifier(agentId); if (!valid.ok) return valid; }
  return success({ ...bounds.value, search, ...(agentId === null ? {} : { agentId }) });
}
export function roomContext(input: unknown): Result<{ agentId?: string }> {
  const parsed = listQuery(['agentId'])(input);
  if (!parsed.ok) return parsed;
  const agentId = parsed.value.get('agentId');
  if (agentId === null) return success({});
  const valid = check.identifier(agentId);
  return valid.ok ? success({ agentId }) : valid;
}
export function none(input: unknown) {
  const parsed = listQuery([])(input);
  return parsed.ok ? success({}) : parsed;
}
