import { randomUUID } from 'node:crypto';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { MatrixAuthority, MatrixEvent, RoomFacts, RoomMembership, RoomInvitation } from '@crossfire/domain/port/matrix-authority';
export function matrixAuthorityFixture() {
  const accounts = new Map<string, { token: string; displayName: string; active: boolean; password: string }>();
  const rooms = new Map<string, { name: string; creator: string; members: Map<string, RoomMembership> }>();
  const events = new Map<string, MatrixEvent>();
  const notices = new Map<string, { body: string; senderMatrixId: string; eventId: string }>();
  const invitations = new Map<string, RoomInvitation>();
  const ownerRooms = new Map<string, string>();
  let noticeFailure: Result<string> | null = null;
  function facts(matrixUserId: string, roomId: string): Result<RoomFacts> {
    const room = rooms.get(roomId), member = room?.members.get(matrixUserId);
    if (!room || !member || member.membership !== 'join') return failure('forbidden', 'Not a native room member');
    return success({ roomId, name: room.name, topic: '', alias: null, matrixUserId,
      ...(room.creator === matrixUserId ? { creator: true as const, powerLevel: null } : { creator: false as const, powerLevel: member.powerLevel ?? 0 }),
      creatorIds: [room.creator], readLevel: -1, replyLevel: 0, inviteLevel: 0, kickLevel: 50, changePowerLevel: 50,
      nativePermissions: [{ action: 'm.room.message', level: 0 }, { action: 'invite', level: 0 }] });
  }
  async function createRoom(id: string, name: string) {
    const roomId = '!' + randomUUID() + ':test.localhost';
    rooms.set(roomId, { name, creator: id, members: new Map([[id, { matrixUserId: id, displayName: id, membership: 'join', creator: true, powerLevel: null }]]) });
    return success({ roomId, name });
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
    async ownerConversation(owner, agent, selected) {
      const key = JSON.stringify([owner, agent]);
      const existing = selected ?? ownerRooms.get(key);
      const created = existing ? success({ roomId: existing }) : await createRoom(owner, 'Owner DM');
      if (!created.ok) return created;
      const roomId = created.value.roomId;
      const room = rooms.get(roomId);
      if (!room || room.creator !== owner || [...room.members].some(([id, member]) => id !== owner && id !== agent && ['join', 'invite'].includes(member.membership))) return failure('forbidden', 'Invalid private owner DM');
      room.members.set(owner, { matrixUserId: owner, displayName: owner, membership: 'join', creator: true, powerLevel: null });
      const previous = room.members.get(agent);
      room.members.set(agent, { matrixUserId: agent, displayName: agent, membership: 'join', creator: false, powerLevel: previous?.powerLevel ?? 0 });
      ownerRooms.set(key, roomId);
      return success(roomId);
    },
    async verifyOwnerConversation(owner, agent, roomId) {
      const room = rooms.get(roomId);
      return room && room.creator === owner && ![...room.members].some(([id, member]) => id !== owner && id !== agent && ['join', 'invite'].includes(member.membership))
        ? success(undefined) : failure('forbidden', 'Invalid private owner DM');
    },
    async markDirect() { return success(undefined); },
    async room(id, roomId) { return facts(id, roomId); },
    async membership(id, targetId, roomId) {
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      return success(rooms.get(roomId)!.members.get(targetId) ?? { matrixUserId: targetId, displayName: targetId, membership: 'leave', creator: false, powerLevel: 0 });
    },
    async invitation(id, roomId) { return success(rooms.get(roomId)?.members.get(id)?.membership === 'invite' ? invitations.get(roomId + ':' + id) ?? null : null); },
    async setRoomAccess(id, targetId, roomId, access, admission) {
      const { powerLevel } = access;
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      if (!authority.value.creator && powerLevel > authority.value.powerLevel) return failure('forbidden', 'Native ceiling exceeded');
      const members = rooms.get(roomId)!.members, previous = members.get(targetId);
      if (admission?.kind === 'invitation' && previous?.membership !== 'join'
        && invitations.get(roomId + ':' + targetId)?.eventId !== admission.eventId) return failure('conflict', 'Native invitation was withdrawn or replaced');
      const member: RoomMembership = { matrixUserId: targetId, displayName: accounts.get(targetId)?.displayName ?? targetId,
        membership: admission ? 'join' : previous?.membership ?? 'leave', creator: false, powerLevel };
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
    close() {},
  };
  return { matrix, accounts, rooms, events, notices, invitations, createRoom, setNoticeFailure(value: Result<string> | null) { noticeFailure = value; } };
}
