import { randomUUID } from 'node:crypto';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { MatrixAuthority, MatrixEvent, RoomFacts, RoomMembership } from '@crossfire/domain/port/matrix-authority';
export function matrixAuthorityFixture() {
  const accounts = new Map<string, { token: string; displayName: string; active: boolean; password: string }>();
  const rooms = new Map<string, { name: string; creator: string; members: Map<string, RoomMembership> }>();
  const events = new Map<string, MatrixEvent>();
  const notices = new Map<string, { body: string; senderMatrixId: string; eventId: string }>();
  let noticeFailure: Result<string> | null = null;
  function facts(matrixUserId: string, roomId: string): Result<RoomFacts> {
    const room = rooms.get(roomId), member = room?.members.get(matrixUserId);
    if (!room || !member || member.membership !== 'join') return failure('forbidden', 'Not a native room member');
    return success({ roomId, name: room.name, topic: '', alias: null, matrixUserId, powerLevel: member.powerLevel, creator: room.creator === matrixUserId,
      creatorIds: [room.creator], readLevel: -1, replyLevel: 0, inviteLevel: 0, kickLevel: 50, changePowerLevel: 50,
      nativePermissions: [{ action: 'm.room.message', level: 0 }, { action: 'invite', level: 0 }] });
  }
  const matrix: MatrixAuthority = {
    async identify(token) {
      const account = [...accounts].find(([, value]) => value.token === token && value.active);
      return account ? success(account[0]) : failure('unauthorized', 'Invalid native token');
    },
    async exists(id) { return success(accounts.has(id)); },
    async provision(userId, password, deviceId) {
      const prior = accounts.get(userId);
      if (prior && (!prior.active || prior.password !== password)) return failure('native', 'Native credentials do not match');
      const account = prior ?? { token: randomUUID(), displayName: userId, active: true, password };
      accounts.set(userId, account);
      return success({ userId, accessToken: account.token, deviceId });
    },
    async deactivate(id) { const account = accounts.get(id); if (account) account.active = false; return success(undefined); },
    async discard(id) { accounts.delete(id); return success(undefined); },
    async profileName(id) { return success(accounts.get(id)?.displayName ?? null); },
    async setDisplayName(id, name) { const account = accounts.get(id); if (!account) return failure('missing', 'Native account missing'); account.displayName = name; return success(undefined); },
    async joined(id) { return success([...rooms].filter(([, room]) => room.members.get(id)?.membership === 'join').map(([id]) => id)); },
    async room(id, roomId) { return facts(id, roomId); },
    async membership(id, targetId, roomId) {
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      return success(rooms.get(roomId)!.members.get(targetId) ?? { matrixUserId: targetId, displayName: targetId, membership: 'leave', powerLevel: 0 });
    },
    async setRoomAccess(id, targetId, roomId, powerLevel, admit) {
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      if (!authority.value.creator && powerLevel > authority.value.powerLevel) return failure('forbidden', 'Native ceiling exceeded');
      const members = rooms.get(roomId)!.members, previous = members.get(targetId);
      const member: RoomMembership = { matrixUserId: targetId, displayName: accounts.get(targetId)?.displayName ?? targetId,
        membership: admit ? 'join' : previous?.membership ?? 'leave', powerLevel };
      members.set(targetId, member); return success(member);
    },
    async leave(id, roomId) {
      const member = rooms.get(roomId)?.members.get(id);
      if (member) member.membership = 'leave';
      return success(undefined);
    },
    async event(_id, roomId, eventId) {
      const event = events.get(eventId);
      return event && event.roomId === roomId ? success(event) : failure('missing', 'Native event missing');
    },
    async sendNotice(_id, _room, transaction, body, senderMatrixId) {
      if (noticeFailure) return noticeFailure;
      const existing = notices.get(transaction) ?? { body, senderMatrixId, eventId: '$notice-' + randomUUID() };
      notices.set(transaction, existing);
      return success(existing.eventId);
    },
    async createRoom(id, name) {
      const roomId = '!' + randomUUID() + ':test.localhost';
      rooms.set(roomId, { name, creator: id, members: new Map([[id, { matrixUserId: id, displayName: id, membership: 'join', powerLevel: 100 }]]) });
      return success({ roomId, name });
    },
    async members(id, roomId) { const permission = facts(id, roomId); return permission.ok ? success([...rooms.get(roomId)!.members.values()]) : permission; },
    async changeMembership(id, roomId, targetId, action) {
      const permission = facts(id, roomId);
      if (!permission.ok) return permission;
      const room = rooms.get(roomId)!;
      room.members.set(targetId, { matrixUserId: targetId, displayName: targetId, membership: action === 'invite' ? 'invite' : 'leave', powerLevel: 0 });
      return success(undefined);
    },
    close() {},
  };
  return { matrix, accounts, rooms, events, notices, setNoticeFailure(value: Result<string> | null) { noticeFailure = value; } };
}
