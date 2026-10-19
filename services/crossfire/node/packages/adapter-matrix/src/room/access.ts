import { createHash } from 'node:crypto';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { RoomAccessIntent, RoomFacts, RoomMembership } from '@ctlflow/crossfire-domain/port/messaging';

export type MatrixPower = { creator: true; powerLevel: null } | { creator: false; powerLevel: number };
export type MatrixRoomFacts = {
  roomId: string; name: string; topic: string; alias: string | null; backendUserId: string; creatorIds: string[];
  readLevel: number; replyLevel: number; inviteLevel: number; kickLevel: number; changePowerLevel: number;
  nativePermissions: { action: string; level: number }[];
} & MatrixPower;
export type MatrixMembership = { backendUserId: string; displayName: string; membership: RoomMembership['membership'] } & MatrixPower;

export function requestedPower(facts: MatrixRoomFacts, target: string, intent: RoomAccessIntent, reconcile = false): Result<number> {
  if (facts.creatorIds.includes(target) && intent.accessMode !== 'reply') return failure('forbidden', 'Matrix creator authority cannot be restricted by an agent grant');
  const custom = intent.nativeAccess;
  if (intent.accessMode === 'custom' && (!custom || Object.keys(custom).length !== 1 || typeof custom.powerLevel !== 'number'
    || !Number.isSafeInteger(custom.powerLevel))) return failure('invalid', 'Matrix custom access requires one finite integer powerLevel parameter');
  if (intent.accessMode !== 'custom' && custom !== null) return failure('invalid', 'Only custom access accepts native parameters');
  let level = intent.accessMode === 'read' ? facts.readLevel : intent.accessMode === 'reply' ? facts.replyLevel : custom?.powerLevel;
  if (typeof level !== 'number' || !Number.isSafeInteger(level)) return failure('invalid', 'Unsupported Matrix room access');
  if (reconcile && intent.accessMode === 'custom' && !facts.creator) level = Math.min(level, facts.powerLevel);
  return facts.creator || level <= facts.powerLevel ? success(level) : failure('forbidden', 'Requested access exceeds the authorizer’s Matrix room permissions');
}

export function roomView(facts: MatrixRoomFacts, subjectUserId?: string): RoomFacts {
  const maximum = facts.creator ? Number.MAX_SAFE_INTEGER : facts.powerLevel;
  const permissions = facts.nativePermissions.toSorted((left, right) => left.action.localeCompare(right.action));
  const authorityRevision = createHash('sha256').update(JSON.stringify({ creator: facts.creator, level: facts.powerLevel,
    creators: [...facts.creatorIds].sort(), read: facts.readLevel, reply: facts.replyLevel, invite: facts.inviteLevel, permissions })).digest('hex');
  return { roomId: facts.roomId, name: facts.name, topic: facts.topic, alias: facts.alias, backendUserId: facts.backendUserId,
    canInvite: facts.creator || facts.powerLevel >= facts.inviteLevel, authorityRevision,
    accessModes: subjectUserId && facts.creatorIds.includes(subjectUserId) ? ['reply']
      : ['read', ...(facts.creator || facts.replyLevel <= maximum ? ['reply' as const] : []), 'custom'],
    accessFields: [{ key: 'powerLevel', label: 'Matrix power level', minimum: Number.MIN_SAFE_INTEGER, maximum, defaultValue: Math.min(0, maximum) }],
    permissions: permissions.map(permission => ({ action: permission.action, label: permission.action + ' · required level ' + permission.level,
      allowed: facts.creator || permission.level <= facts.powerLevel })) };
}

export function membershipView(value: MatrixMembership): RoomMembership {
  return { backendUserId: value.backendUserId, displayName: value.displayName, membership: value.membership,
    nativeAccess: { creator: value.creator, powerLevel: value.powerLevel } };
}
