import { object, userId, roomId, text, revision, role, status, type MemberView } from './management.js';
import { failure, success, type Result } from '../../kernel/src/result.js';

export type SessionView = { human: MemberView; csrf: string };
export type EnrollmentView = { id: string; owner: string; name: string; code: string; status: 'pending' | 'approved' | 'rejected'; expires: number; agent: string | null };
export type InvitationView = { id: string; role: 'member' | 'administrator'; expires: number; used: string | null; revoked: number };
export type AuditView = { id: number; actor: string; target: string; action: string; detail: string; created: number };
export type AgentRoomView = { id: string; name: string; topic: string; alias: string | null; ownerLevel: number;
  ownerCreator: boolean; readLevel: number; replyLevel: number | null; permissions: { action: string; level: number }[] };
export type RoomView = { id: string; name: string };
export type RoomMemberView = { id: string; name: string; membership: 'join' | 'invite'; removable: boolean };
export type Page<T> = { items: T[]; next: string | number | null };

export function member(value: unknown): Result<MemberView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  if (!userId(data.id) || !text(data.label) || !role(data.role) || !status(data.status) || !revision(data.revision)
    || data.appliedStatus !== null && !status(data.appliedStatus) || data.appliedRevision !== null && !revision(data.appliedRevision)
    || data.lastSuccess !== null && !revision(data.lastSuccess) || data.error !== null && !text(data.error, 4096)) return failure('invalid', 'Invalid member response');
  return success(data as MemberView);
}
export function session(value: unknown): Result<SessionView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const human = member(parsed.value.human);
  return human.ok && text(parsed.value.csrf, 100) ? success({ human: human.value, csrf: parsed.value.csrf }) : failure('invalid', 'Invalid human session');
}
export function enrollment(value: unknown): Result<EnrollmentView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  return text(data.id, 36) && userId(data.owner) && text(data.name) && text(data.code, 12)
    && ['pending', 'approved', 'rejected'].includes(String(data.status)) && revision(data.expires)
    && (data.agent === null || text(data.agent, 36)) ? success(data as EnrollmentView) : failure('invalid', 'Invalid enrollment response');
}
export function invitation(value: unknown): Result<InvitationView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  return text(data.id, 36) && role(data.role) && revision(data.expires) && (data.used === null || userId(data.used))
    && (data.revoked === 0 || data.revoked === 1) ? success(data as InvitationView) : failure('invalid', 'Invalid invitation response');
}
export function audit(value: unknown): Result<AuditView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  return revision(data.id) && text(data.actor, 255) && text(data.target, 255) && text(data.action)
    && typeof data.detail === 'string' && revision(data.created) ? success(data as AuditView) : failure('invalid', 'Invalid audit response');
}
export function agentRoom(value: unknown): Result<AgentRoomView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  const integer = (input: unknown) => typeof input === 'number' && Number.isSafeInteger(input);
  return roomId(data.id) && text(data.name, 255) && typeof data.topic === 'string' && data.topic.length <= 4096
    && (data.alias === null || text(data.alias, 255)) && integer(data.ownerLevel) && typeof data.ownerCreator === 'boolean'
    && integer(data.readLevel) && (data.replyLevel === null || integer(data.replyLevel)) && Array.isArray(data.permissions)
    && data.permissions.length <= 1000 && data.permissions.every(permission => {
      const item = object(permission);
      return item.ok && text(item.value.action, 255) && integer(item.value.level);
    }) ? success(data as AgentRoomView) : failure('invalid', 'Invalid room response');
}
export function managedRoom(value: unknown): Result<RoomView> {
  const parsed = object(value);
  return parsed.ok && roomId(parsed.value.id) && text(parsed.value.name, 255)
    ? success({ id: parsed.value.id, name: parsed.value.name }) : failure('invalid', 'Invalid room response');
}
export function roomMember(value: unknown): Result<RoomMemberView> {
  const parsed = object(value);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  return userId(data.id) && text(data.name, 255) && (data.membership === 'join' || data.membership === 'invite') && typeof data.removable === 'boolean'
    ? success({ id: data.id, name: data.name, membership: data.membership, removable: data.removable }) : failure('invalid', 'Invalid room member response');
}
export function pageOf<T>(parser: (value: unknown) => Result<T>): (value: unknown) => Result<Page<T>> {
  return value => {
    const parsed = object(value);
    if (!parsed.ok) return parsed;
    const data = parsed.value;
    if (!Array.isArray(data.items) || data.items.length > 100 || data.next !== null && typeof data.next !== 'string' && !revision(data.next)) return failure('invalid', 'Invalid page response');
    const items: T[] = [];
    for (const item of data.items) { const row = parser(item); if (!row.ok) return row; items.push(row.value); }
    return success({ items, next: data.next as Page<T>['next'] });
  };
}
