import { randomUUID } from 'node:crypto';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { MessagingAuthority, BackendEvent, RoomInvitation } from '@ctlflow/crossfire-domain/port/messaging';
import { requestedPower, roomView, membershipView, type MatrixRoomFacts, type MatrixMembership } from '@ctlflow/crossfire-adapter-matrix/room/access';
import { userId } from '@ctlflow/crossfire-adapter-matrix/syntax';
export function matrixAuthorityFixture() {
  const accounts = new Map<string, { token: string; displayName: string; active: boolean; password: string }>();
  const rooms = new Map<string, { name: string; creator: string; members: Map<string, MatrixMembership> }>();
  const events = new Map<string, BackendEvent>();
  const notices = new Map<string, { body: string; senderBackendUserId: string; eventId: string }>();
  const invitations = new Map<string, RoomInvitation>();
  const ownerRooms = new Map<string, string>();
  let noticeFailure: Result<string> | null = null;
  function facts(backendUserId: string, roomId: string): Result<MatrixRoomFacts> {
    const room = rooms.get(roomId), member = room?.members.get(backendUserId);
    if (!room || !member || member.membership !== 'join') return failure('forbidden', 'Not a native room member');
    return success({ roomId, name: room.name, topic: '', alias: null, backendUserId,
      ...(room.creator === backendUserId ? { creator: true as const, powerLevel: null } : { creator: false as const, powerLevel: member.powerLevel ?? 0 }),
      creatorIds: [room.creator], readLevel: -1, replyLevel: 0, inviteLevel: 0, kickLevel: 50, changePowerLevel: 50,
      nativePermissions: [{ action: 'm.room.message', level: 0 }, { action: 'invite', level: 0 }] });
  }
  async function createRoom(id: string, name: string) {
    const roomId = '!' + randomUUID() + ':test.localhost';
    rooms.set(roomId, { name, creator: id, members: new Map([[id, { backendUserId: id, displayName: id, membership: 'join', creator: true, powerLevel: null }]]) });
    return success({ roomId, name });
  }
  const matrix: MessagingAuthority = {
    describe(publicOrigin) { return { type: 'matrix', label: 'Matrix', chatUrl: publicOrigin + '/', signupUrl: publicOrigin + '/#/register', signupInstructions: ['Continue to chat to register.'], configuration: { type: 'matrix', parameters: { origin: publicOrigin, serverName: 'test.localhost' } } }; },
    async authenticate(username, password) { const id = userId(username) ? username : '@' + username + ':test.localhost'; const account = accounts.get(id); return account?.active && account.password === password ? success(account.token) : failure('unauthorized', 'Messaging sign-in failed'); },
    agentUserId(id) { return '@agent-' + id + ':test.localhost'; },
    serviceUserId() { return '@crossfire-tests:test.localhost'; },
    localLabel(id) { return id.slice(1, id.indexOf(':')); },
    registrationUserId(input) { return /^[a-z0-9][a-z0-9._=-]{0,99}$/u.test(input.username) && !input.username.startsWith('agent-') && input.password.length >= 12 ? success('@' + input.username + ':test.localhost') : failure('invalid', 'Invalid Matrix signup'); },
    agentAccount(userId, accessToken) { return { userId, accessToken, native: { deviceId: 'CROSSFIRE_AGENT' } }; },
    async identify(token) {
      const account = [...accounts].find(([, value]) => value.token === token && value.active);
      return account ? success(account[0]) : failure('unauthorized', 'Invalid native token');
    },
    async exists(id) { return success(accounts.has(id)); },
    async provision(userId, password, native = {}) {
      const prior = accounts.get(userId);
      if (prior && (!prior.active || prior.password !== password)) return failure('native', 'Native credentials do not match');
      const account = prior ?? { token: randomUUID(), displayName: userId, active: true, password };
      accounts.set(userId, account);
      return success({ userId, accessToken: account.token, native });
    },
    async deactivate(id) { const account = accounts.get(id); if (account) account.active = false; return success(undefined); },
    async discard(id) { accounts.delete(id); return success(undefined); },
    async profileName(id) { return success(accounts.get(id)?.displayName ?? null); },
    async setDisplayName(id, name) { const account = accounts.get(id); if (!account) return failure('missing', 'Native account missing'); account.displayName = name; return success(undefined); },
    async joined(id) { return success([...rooms].filter(([, room]) => room.members.get(id)?.membership === 'join').map(([id]) => id)); },
    async ownerConversation(owner, agent, selected, previousName) {
      const key = JSON.stringify([owner, agent]);
      const existing = selected ?? ownerRooms.get(key);
      const displayName = accounts.get(agent)?.displayName ?? agent;
      const created = existing ? success({ roomId: existing }) : await createRoom(owner, displayName);
      if (!created.ok) return created;
      const roomId = created.value.roomId;
      const room = rooms.get(roomId);
      if (!room || room.creator !== owner || [...room.members].some(([id, member]) => id !== owner && id !== agent && ['join', 'invite'].includes(member.membership))) return failure('forbidden', 'Invalid private owner DM');
      if (!room.name || previousName !== null && room.name === previousName) room.name = displayName;
      room.members.set(owner, { backendUserId: owner, displayName: owner, membership: 'join', creator: true, powerLevel: null });
      const previous = room.members.get(agent);
      room.members.set(agent, { backendUserId: agent, displayName: agent, membership: 'join', creator: false, powerLevel: previous?.powerLevel ?? 0 });
      ownerRooms.set(key, roomId);
      return success(roomId);
    },
    async verifyOwnerConversation(owner, agent, roomId) {
      const room = rooms.get(roomId);
      return room && room.creator === owner && ![...room.members].some(([id, member]) => id !== owner && id !== agent && ['join', 'invite'].includes(member.membership))
        ? success(undefined) : failure('forbidden', 'Invalid private owner DM');
    },
    async markDirect() { return success(undefined); },
    async room(id, roomId, subject) { const result = facts(id, roomId); return result.ok ? success(roomView(result.value, subject)) : result; },
    async authorizeRoomAccess(id, target, roomId, access) { const result = facts(id, roomId); if (!result.ok) return result; const power = requestedPower(result.value, target, access); return power.ok ? success(roomView(result.value, target)) : power; },
    async membership(id, targetId, roomId) {
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      return success(membershipView(rooms.get(roomId)!.members.get(targetId) ?? { backendUserId: targetId, displayName: targetId, membership: 'leave', creator: false, powerLevel: 0 }));
    },
    async invitation(id, roomId) { return success(rooms.get(roomId)?.members.get(id)?.membership === 'invite' ? invitations.get(roomId + ':' + id) ?? null : null); },
    async setRoomAccess(id, targetId, roomId, access, admission) {
      const authority = facts(id, roomId);
      if (!authority.ok) return authority;
      const power = requestedPower(authority.value, targetId, access, true); if (!power.ok) return power;
      const members = rooms.get(roomId)!.members, previous = members.get(targetId);
      if (admission?.kind === 'invitation' && previous?.membership !== 'join'
        && invitations.get(roomId + ':' + targetId)?.eventId !== admission.eventId) return failure('conflict', 'Native invitation was withdrawn or replaced');
      const member: MatrixMembership = { backendUserId: targetId, displayName: accounts.get(targetId)?.displayName ?? targetId,
        membership: admission ? 'join' : previous?.membership ?? 'leave', creator: false, powerLevel: power.value };
      members.set(targetId, member); return success(membershipView(member));
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
    async sendNotice(_id, _room, transaction, body, senderBackendUserId) {
      if (noticeFailure) return noticeFailure;
      const existing = notices.get(transaction) ?? { body, senderBackendUserId, eventId: '$notice-' + randomUUID() };
      notices.set(transaction, existing);
      return success(existing.eventId);
    },
    close() {},
  };
  return { messaging: matrix, accounts, rooms, events, notices, invitations, createRoom, setNoticeFailure(value: Result<string> | null) { noticeFailure = value; } };
}
