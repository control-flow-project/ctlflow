import { authority, type Config } from './account/authority.js';
import { joined, roomFacts, roomCreators, roomPowers } from './room/facts.js';
import { createInvitationReader, invitationEvent } from './room/invitation.js';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { MatrixAuthority, RoomFacts, RoomMembership } from '@crossfire/domain/port/matrix-authority';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk, nativeRequest, nativeState } from './http.js';
import { object, text, userId } from '@crossfire/contracts/validation';
import { LISTENER_NOTICE, isListenerNotice } from '@crossfire/contracts/notices';

export function createMatrixAuthority(config: Config): MatrixAuthority {
  const accounts = authority(config);
  const invitationSender = createInvitationReader();
  async function room(matrixUserId: string, roomId: string): Promise<Result<RoomFacts>> {
    const client = await accounts.asUser(matrixUserId);
    if (!client.ok) return client;
    const facts = await roomFacts(client.value, matrixUserId, roomId);
    if (!facts.ok) return facts;
    const { powers } = facts.value;
    const events = object(powers.events ?? {});
    if (!events.ok) return failure('native', 'Invalid native power map');
    const maximum = facts.value.ownerCreator ? Number.MAX_SAFE_INTEGER : facts.value.ownerLevel;
    const readLevel = Math.min(maximum, facts.value.ceiling, facts.value.ordinary - 1, facts.value.message - 1, facts.value.reaction - 1);
    const nativePermissions = [{ action: 'm.room.message', level: facts.value.message }, { action: 'm.reaction', level: facts.value.reaction },
      { action: 'events_default', level: facts.value.ordinary },
      ...[['invite', 0], ['kick', 50], ['ban', 50], ['redact', 50], ['state_default', 50]].map(([action, fallback]) => ({ action: String(action), level: Number(powers[String(action)] ?? fallback) })),
      ...Object.entries(events.value).filter(([action]) => !['m.room.message', 'm.reaction'].includes(action)).map(([action, value]) => ({ action, level: Number(value) }))];
    if (!Number.isSafeInteger(readLevel) || nativePermissions.some(permission => !Number.isSafeInteger(permission.level))) return failure('native', 'Invalid native permission levels');
    return success({ roomId, name: facts.value.name, topic: facts.value.topic, alias: facts.value.alias, matrixUserId,
      ...(facts.value.ownerCreator ? { powerLevel: null, creator: true as const } : { powerLevel: facts.value.ownerLevel, creator: false as const }), creatorIds: facts.value.creators,
      readLevel, replyLevel: Math.max(facts.value.message, facts.value.reaction), inviteLevel: Number(powers.invite ?? 0),
      kickLevel: Number(powers.kick ?? 50), changePowerLevel: Number(events.value['m.room.power_levels'] ?? powers.state_default ?? 50), nativePermissions });
  }
  async function membershipState(matrixUserId: string, targetMatrixId: string, roomId: string): Promise<Result<{ member: RoomMembership; readLevel: number; replyLevel: number }>> {
    const client = await accounts.asUser(matrixUserId);
    if (!client.ok) return client;
    const state = await nativeState(client.value, roomId);
    if (!state.ok) return state;
    const content = state.value.find(event => event.type === 'm.room.member' && event.state_key === targetMatrixId)?.content;
    const current = content?.membership ?? 'leave';
    if (current !== 'join' && current !== 'invite' && current !== 'leave' && current !== 'ban') return failure('native', 'Unsupported native membership');
    const powers = state.value.find(event => event.type === 'm.room.power_levels' && event.state_key === '')?.content;
    if (!powers) return failure('native', 'Native room power levels are missing');
    const levels = roomPowers(powers, targetMatrixId);
    if (!levels.ok) return levels;
    const creators = roomCreators(state.value);
    if (!creators.ok) return creators;
    const identity: Pick<RoomMembership, 'matrixUserId' | 'displayName' | 'membership'> = {
      matrixUserId: targetMatrixId, displayName: text(content?.displayname, 255) ? content.displayname : targetMatrixId, membership: current };
    const member: RoomMembership = creators.value.includes(targetMatrixId) ? { ...identity, creator: true, powerLevel: null }
      : { ...identity, creator: false, powerLevel: levels.value.ownerLevel };
    return success({ member, readLevel: Math.min(levels.value.ceiling, levels.value.ordinary - 1, levels.value.message - 1, levels.value.reaction - 1),
      replyLevel: Math.max(levels.value.message, levels.value.reaction) });
  }
  async function membership(matrixUserId: string, targetMatrixId: string, roomId: string): Promise<Result<RoomMembership>> {
    const result = await membershipState(matrixUserId, targetMatrixId, roomId);
    return result.ok ? success(result.value.member) : result;
  }
  async function leave(matrixUserId: string, roomId: string): Promise<Result<void>> {
    const client = await accounts.asUser(matrixUserId);
    if (!client.ok) return client;
    const response = await nativeOk(client.value, 'POST', API + '/rooms/' + segment(roomId) + '/leave', {});
    return response.ok ? success(undefined) : response;
  }
  async function inviteToRoom(matrixUserId: string, roomId: string, targetMatrixId: string): Promise<Result<void>> {
    const client = await accounts.asUser(matrixUserId);
    if (!client.ok) return client;
    const changed = await nativeOk(client.value, 'POST', API + '/rooms/' + segment(roomId) + '/invite', { user_id: targetMatrixId });
    return changed.ok ? success(undefined) : changed;
  }
  return {
    identify: accounts.identify, exists: accounts.exists, deactivate: accounts.deactivate, discard: accounts.discard, profileName: accounts.profileName, close: accounts.close,
    async provision(matrixUserId, password, deviceId) {
      const created = await accounts.provision(matrixUserId, password, deviceId);
      return created.ok ? success({ userId: created.value.user_id, accessToken: created.value.access_token, deviceId: created.value.device_id }) : created;
    },
    async setDisplayName(matrixUserId, displayName) {
      const client = await accounts.asUser(matrixUserId);
      if (!client.ok) return client;
      const response = await nativeOk(client.value, 'PUT', API + '/profile/' + segment(matrixUserId) + '/displayname', { displayname: displayName });
      return response.ok ? success(undefined) : response;
    },
    async joined(matrixUserId) { const client = await accounts.asUser(matrixUserId); return client.ok ? joined(client.value) : client; },
    room, membership, leave,
    async invitation(matrixUserId, roomId) {
      const target = await accounts.asUser(matrixUserId);
      if (!target.ok) return target;
      const sender = await invitationSender(target.value, matrixUserId, roomId);
      if (!sender.ok || sender.value === null) return sender.ok ? success(null) : sender;
      if (!sender.value.endsWith(':' + config.serverName)) return failure('forbidden', 'The native inviter must be a local Crossfire identity');
      const authorizer = await accounts.asUser(sender.value);
      return authorizer.ok ? invitationEvent(authorizer.value, matrixUserId, roomId, sender.value) : authorizer;
    },
    async setRoomAccess(authorizerMatrixId, targetMatrixId, roomId, access, admission) {
      const { powerLevel } = access;
      const facts = await room(authorizerMatrixId, roomId);
      if (!facts.ok) return facts;
      if (!Number.isSafeInteger(powerLevel) || !facts.value.creator && powerLevel > facts.value.powerLevel) return failure('forbidden', 'Requested power exceeds native authority');
      if (facts.value.creatorIds.includes(targetMatrixId) && access.mode !== 'reply') return failure('forbidden', 'Native creator authority cannot be restricted by an agent grant');
      if (!facts.value.creatorIds.includes(targetMatrixId) && access.mode === 'reply' && powerLevel < facts.value.replyLevel) return failure('forbidden', 'Read-and-reply access requires native reply authority');
      const current = await membership(authorizerMatrixId, targetMatrixId, roomId);
      if (!current.ok) return current;
      if (admission === null && current.value.membership !== 'join') return current;
      const client = await accounts.asUser(authorizerMatrixId);
      if (!client.ok) return client;
      const authorizedClient = client.value;
      const path = API + '/rooms/' + segment(roomId);
      async function verifyInvitation(): Promise<Result<void>> {
        if (admission?.kind !== 'invitation' || current.ok && current.value.membership === 'join') return success(undefined);
        if (admission.senderMatrixId !== authorizerMatrixId) return failure('forbidden', 'Native invitation authority does not match');
        const invitation = await invitationEvent(authorizedClient, targetMatrixId, roomId, authorizerMatrixId);
        return !invitation.ok ? invitation : invitation.value?.eventId === admission.eventId ? success(undefined)
          : failure('conflict', 'Native invitation was withdrawn or replaced');
      }
      const verified = await verifyInvitation();
      if (!verified.ok) return verified;
      if (!current.value.creator && current.value.powerLevel !== powerLevel) {
        const powers = await nativeOk(client.value, 'GET', path + '/state/m.room.power_levels');
        if (!powers.ok) return powers;
        const users = object(powers.value.users ?? {});
        if (!users.ok) return failure('native', 'Invalid native power levels');
        const result = await nativeOk(client.value, 'PUT', path + '/state/m.room.power_levels', { ...powers.value, users: { ...users.value, [targetMatrixId]: powerLevel } });
        if (!result.ok) return result;
      }
      if (current.value.membership !== 'join') {
        if (admission?.kind === 'managed') {
          const invited = await inviteToRoom(authorizerMatrixId, roomId, targetMatrixId);
          if (!invited.ok) return invited;
        } else {
          const currentInvitation = await verifyInvitation();
          if (!currentInvitation.ok) return currentInvitation;
        }
        const target = await accounts.asUser(targetMatrixId);
        if (!target.ok) return target;
        const accepted = await nativeOk(target.value, 'POST', path + '/join', {});
        if (!accepted.ok) return accepted;
      }
      const checked = await membershipState(authorizerMatrixId, targetMatrixId, roomId);
      if (!checked.ok) return checked;
      const member = checked.value.member;
      if (member.membership !== 'join' || (member.creator ? access.mode !== 'reply' : member.powerLevel !== powerLevel
        || access.mode === 'reply' && member.powerLevel < checked.value.replyLevel || access.mode === 'read' && member.powerLevel > checked.value.readLevel)) {
        return failure('native', 'Native room membership and requested permissions were not confirmed');
      }
      return success(member);
    },
    async event(matrixUserId, roomId, eventId) {
      const client = await accounts.asUser(matrixUserId);
      if (!client.ok) return client;
      const result = await nativeOk(client.value, 'GET', API + '/rooms/' + segment(roomId) + '/event/' + segment(eventId));
      if (!result.ok) return result;
      const event = result.value;
      const content = object(event.content);
      if (!content.ok || event.event_id !== eventId || !userId(event.sender) || typeof event.type !== 'string') return failure('native', 'Invalid native event');
      const mentions = object(content.value['m.mentions'] ?? {});
      const relation = object(content.value['m.relates_to'] ?? {});
      const ids = mentions.ok && Array.isArray(mentions.value.user_ids) ? mentions.value.user_ids : [];
      if (!ids.every(userId)) return failure('native', 'Invalid native mention identities');
      return success({ eventId, roomId, senderMatrixId: event.sender, type: event.type,
        messageType: typeof content.value.msgtype === 'string' ? content.value.msgtype : null,
        body: typeof content.value.body === 'string' ? content.value.body : null, mentions: ids,
        edited: 'm.new_content' in content.value || relation.ok && relation.value.rel_type === 'm.replace',
        control: isListenerNotice({ type: event.type, content: content.value }) });
    },
    async sendNotice(matrixUserId, roomId, transactionId, body, senderMatrixId) {
      const client = await accounts.asUser(matrixUserId);
      if (!client.ok) return client;
      const result = await nativeRequest(client.value, 'PUT', API + '/rooms/' + segment(roomId) + '/send/m.room.message/' + segment(transactionId),
        { msgtype: 'm.notice', body, 'm.mentions': { user_ids: [senderMatrixId] }, [LISTENER_NOTICE]: true });
      if (!result.ok) return result;
      if (result.value.status === 403) return failure('forbidden', 'Native room rules do not permit this notice');
      return result.value.status === 200 && typeof result.value.body.event_id === 'string' ? success(result.value.body.event_id) : failure('native', 'Notice publication remains unconfirmed');
    },
  };
}
