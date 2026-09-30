import { authority, type Config } from './account/authority.js';
import { joined, roomFacts } from './room/facts.js';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { MatrixAuthority, RoomFacts, RoomMembership } from '@crossfire/domain/port/matrix-authority';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk, nativeRequest } from './http.js';
import { object, text, userId } from '@crossfire/contracts/validation';

export function createMatrixAuthority(config: Config): MatrixAuthority {
  const accounts = authority(config);
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
      powerLevel: facts.value.ownerLevel, creator: facts.value.ownerCreator, creatorIds: facts.value.creators,
      readLevel, replyLevel: Math.max(facts.value.message, facts.value.reaction), inviteLevel: Number(powers.invite ?? 0),
      kickLevel: Number(powers.kick ?? 50), changePowerLevel: Number(events.value['m.room.power_levels'] ?? powers.state_default ?? 50), nativePermissions });
  }
  async function membership(matrixUserId: string, targetMatrixId: string, roomId: string): Promise<Result<RoomMembership>> {
    const client = await accounts.asUser(matrixUserId);
    if (!client.ok) return client;
    const base = API + '/rooms/' + segment(roomId) + '/state/';
    const membership = await nativeRequest(client.value, 'GET', base + 'm.room.member/' + segment(targetMatrixId));
    if (!membership.ok) return membership;
    if (membership.value.status !== 200 && membership.value.status !== 404) return failure('native', 'Native membership could not be read');
    const content = membership.value.body;
    const current = membership.value.status === 404 ? 'leave' : content.membership;
    if (current !== 'join' && current !== 'invite' && current !== 'leave' && current !== 'ban') return failure('native', 'Unsupported native membership');
    const powers = await nativeOk(client.value, 'GET', base + 'm.room.power_levels');
    if (!powers.ok) return powers;
    const users = object(powers.value.users ?? {});
    if (!users.ok) return failure('native', 'Invalid native user power levels');
    const level = users.value[targetMatrixId] ?? powers.value.users_default ?? 0;
    if (typeof level !== 'number' || !Number.isSafeInteger(level)) return failure('native', 'Invalid native power level');
    return success({ matrixUserId: targetMatrixId, displayName: text(content.displayname, 255) ? content.displayname : targetMatrixId, membership: current, powerLevel: level });
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
    async setRoomAccess(authorizerMatrixId, targetMatrixId, roomId, powerLevel, admit) {
      const facts = await room(authorizerMatrixId, roomId);
      if (!facts.ok) return facts;
      if (!Number.isSafeInteger(powerLevel) || !facts.value.creator && powerLevel > facts.value.powerLevel) return failure('forbidden', 'Requested power exceeds native authority');
      if (facts.value.creatorIds.includes(targetMatrixId)) return failure('forbidden', 'Native creator authority cannot be restricted by an agent grant');
      const current = await membership(authorizerMatrixId, targetMatrixId, roomId);
      if (!current.ok) return current;
      if (!admit && current.value.membership !== 'join') return current;
      const client = await accounts.asUser(authorizerMatrixId);
      if (!client.ok) return client;
      const path = API + '/rooms/' + segment(roomId);
      if (current.value.powerLevel !== powerLevel) {
        const powers = await nativeOk(client.value, 'GET', path + '/state/m.room.power_levels');
        if (!powers.ok) return powers;
        const users = object(powers.value.users ?? {});
        if (!users.ok) return failure('native', 'Invalid native power levels');
        const result = await nativeOk(client.value, 'PUT', path + '/state/m.room.power_levels', { ...powers.value, users: { ...users.value, [targetMatrixId]: powerLevel } });
        if (!result.ok) return result;
      }
      if (current.value.membership !== 'join') {
        const invited = await inviteToRoom(authorizerMatrixId, roomId, targetMatrixId);
        if (!invited.ok) return invited;
        const target = await accounts.asUser(targetMatrixId);
        if (!target.ok) return target;
        const accepted = await nativeOk(target.value, 'POST', path + '/join', {});
        if (!accepted.ok) return accepted;
      }
      const checked = await membership(authorizerMatrixId, targetMatrixId, roomId);
      return checked.ok && (checked.value.membership !== 'join' || checked.value.powerLevel !== powerLevel)
        ? failure('native', 'Native room application was not confirmed') : checked;
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
        control: content.value.msgtype === 'm.notice' && content.value['org.crossfire.wake_blocked'] === true });
    },
    async sendNotice(matrixUserId, roomId, transactionId, body, senderMatrixId) {
      const client = await accounts.asUser(matrixUserId);
      if (!client.ok) return client;
      const result = await nativeRequest(client.value, 'PUT', API + '/rooms/' + segment(roomId) + '/send/m.room.message/' + segment(transactionId),
        { msgtype: 'm.notice', body, 'm.mentions': { user_ids: [senderMatrixId] }, 'org.crossfire.wake_blocked': true });
      if (!result.ok) return result;
      if (result.value.status === 403) return failure('forbidden', 'Native room rules do not permit this notice');
      return result.value.status === 200 && typeof result.value.body.event_id === 'string' ? success(result.value.body.event_id) : failure('native', 'Notice publication remains unconfirmed');
    },
  };
}
