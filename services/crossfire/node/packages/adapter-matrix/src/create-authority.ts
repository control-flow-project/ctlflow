import { authority, type Config } from './account/authority.js';
import { joined, roomFacts } from './room/facts.js';
import { roomCreators, roomPowers } from './room/state.js';
import { createInvitationReader, invitationEvent } from './room/invitation.js';
import { createOwnerConversations, verifyOwnerConversation, markDirect } from './room/owner-conversation.js';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { MessagingAuthority } from '@ctlflow/crossfire-domain/port/messaging';
import { requestedPower, roomView, membershipView, type MatrixRoomFacts, type MatrixMembership } from './room/access.js';
import { API, segment } from './protocol.js';
import { nativeOk, nativeRequest, nativeState } from './http.js';
import { object, text } from '@ctlflow/crossfire-contracts/validation';
import { messageEvent, NOTICE_MARKER } from './events.js';
import type { MatrixEvent } from './values.js';

export function createMessagingAuthority(config: Config): MessagingAuthority {
  const accounts = authority(config);
  const invitationState = createInvitationReader();
  async function direct(backendUserId: string, counterpartBackendUserId: string, roomId: string): Promise<Result<void>> {
    const client = await accounts.asUser(backendUserId);
    return client.ok ? markDirect(client.value, backendUserId, counterpartBackendUserId, roomId) : client;
  }
  async function room(backendUserId: string, roomId: string): Promise<Result<MatrixRoomFacts>> {
    const client = await accounts.asUser(backendUserId);
    if (!client.ok) return client;
    const facts = await roomFacts(client.value, backendUserId, roomId);
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
    return success({ roomId, name: facts.value.name, topic: facts.value.topic, alias: facts.value.alias, backendUserId,
      ...(facts.value.ownerCreator ? { powerLevel: null, creator: true as const } : { powerLevel: facts.value.ownerLevel, creator: false as const }), creatorIds: facts.value.creators,
      readLevel, replyLevel: Math.max(facts.value.message, facts.value.reaction), inviteLevel: Number(powers.invite ?? 0),
      kickLevel: Number(powers.kick ?? 50), changePowerLevel: Number(events.value['m.room.power_levels'] ?? powers.state_default ?? 50), nativePermissions });
  }
  async function membershipState(backendUserId: string, targetBackendUserId: string, roomId: string): Promise<Result<{ member: MatrixMembership; readLevel: number; replyLevel: number }>> {
    const client = await accounts.asUser(backendUserId);
    if (!client.ok) return client;
    const state = await nativeState(client.value, roomId);
    if (!state.ok) return state;
    const content = state.value.find(event => event.type === 'm.room.member' && event.state_key === targetBackendUserId)?.content;
    const current = content?.membership ?? 'leave';
    if (current !== 'join' && current !== 'invite' && current !== 'leave' && current !== 'ban') return failure('native', 'Unsupported native membership');
    const powers = state.value.find(event => event.type === 'm.room.power_levels' && event.state_key === '')?.content;
    if (!powers) return failure('native', 'Native room power levels are missing');
    const levels = roomPowers(powers, targetBackendUserId);
    if (!levels.ok) return levels;
    const creators = roomCreators(state.value);
    if (!creators.ok) return creators;
    const identity: Pick<MatrixMembership, 'backendUserId' | 'displayName' | 'membership'> = {
      backendUserId: targetBackendUserId, displayName: text(content?.displayname, 255) ? content.displayname : targetBackendUserId, membership: current };
    const member: MatrixMembership = creators.value.includes(targetBackendUserId) ? { ...identity, creator: true, powerLevel: null }
      : { ...identity, creator: false, powerLevel: levels.value.ownerLevel };
    return success({ member, readLevel: Math.min(levels.value.ceiling, levels.value.ordinary - 1, levels.value.message - 1, levels.value.reaction - 1),
      replyLevel: Math.max(levels.value.message, levels.value.reaction) });
  }
  async function membership(backendUserId: string, targetBackendUserId: string, roomId: string): Promise<Result<MatrixMembership>> {
    const result = await membershipState(backendUserId, targetBackendUserId, roomId);
    return result.ok ? success(result.value.member) : result;
  }
  async function leave(backendUserId: string, roomId: string): Promise<Result<void>> {
    const client = await accounts.asUser(backendUserId);
    if (!client.ok) return client;
    const response = await nativeOk(client.value, 'POST', API + '/rooms/' + segment(roomId) + '/leave', {});
    return response.ok ? success(undefined) : response;
  }
  async function inviteToRoom(backendUserId: string, roomId: string, targetBackendUserId: string): Promise<Result<void>> {
    const client = await accounts.asUser(backendUserId);
    if (!client.ok) return client;
    const changed = await nativeOk(client.value, 'POST', API + '/rooms/' + segment(roomId) + '/invite', { user_id: targetBackendUserId });
    return changed.ok ? success(undefined) : changed;
  }
  return {
    agentAccount: (userId, accessToken) => ({ userId, accessToken, native: { deviceId: 'CROSSFIRE_AGENT' } }),
    describe: publicOrigin => ({ type: 'matrix', label: 'Matrix', chatUrl: publicOrigin + '/', signupUrl: publicOrigin + '/#/register',
      signupInstructions: ['Continue to Element and choose your username and password.', 'Select “Start authentication” and confirm the invitation in the window it opens.', 'Return to Element to finish signing up.'],
      configuration: { type: 'matrix', parameters: { origin: publicOrigin, serverName: config.serverName } } }),
    async authenticate(username, password) {
      const result = await nativeRequest({ base: config.matrixOrigin }, 'POST', API + '/login', { type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username }, password, initial_device_display_name: 'crossfire management' });
      if (!result.ok) return result;
      return result.value.status === 200 && text(result.value.body.access_token, 8192) ? success(result.value.body.access_token)
        : failure('unauthorized', 'Messaging account sign-in failed');
    },
    agentUserId: agentId => '@agent-' + agentId + ':' + config.serverName,
    serviceUserId: () => config.serviceBackendUserId,
    localLabel: value => value.slice(1, value.indexOf(':')),
    registrationUserId(input) {
      if (!/^[a-z0-9][a-z0-9._=\-]{0,99}$/u.test(input.username) || input.username.startsWith('agent-')
        || input.password.length < 12 || input.password.length > 1024
        || Object.keys(input.native).some(key => key !== 'deviceId')
        || input.native.deviceId !== undefined && !text(input.native.deviceId, 100))
        return failure('invalid', 'Choose a valid Matrix username and a password of at least 12 characters');
      const identity = '@' + input.username + ':' + config.serverName;
      return identity === config.serviceBackendUserId || input.username === 'conduit'
        ? failure('forbidden', 'Reserved Matrix identity') : success(identity);
    },
    ownerConversation: createOwnerConversations(accounts, config.serverName),
    markDirect: direct,
    verifyOwnerConversation: (owner, agent, room) => verifyOwnerConversation(accounts, owner, agent, room),
    identify: accounts.identify, exists: accounts.exists, deactivate: accounts.deactivate, discard: accounts.discard, profileName: accounts.profileName, close: accounts.close,
    async provision(backendUserId, password, native = {}) {
      const deviceId = native.deviceId ?? (backendUserId.startsWith('@agent-') ? 'CROSSFIRE_AGENT' : 'CROSSFIRE_HUMAN');
      if (!text(deviceId, 100) || Object.keys(native).some(key => key !== 'deviceId')) return failure('invalid', 'Invalid Matrix account options');
      const created = await accounts.provision(backendUserId, password, deviceId);
      return created.ok ? success({ userId: created.value.user_id, accessToken: created.value.access_token, native: { deviceId: created.value.device_id } }) : created;
    },
    async setDisplayName(backendUserId, displayName) {
      const client = await accounts.asUser(backendUserId);
      if (!client.ok) return client;
      const response = await nativeOk(client.value, 'PUT', API + '/profile/' + segment(backendUserId) + '/displayname', { displayname: displayName });
      return response.ok ? success(undefined) : response;
    },
    async joined(backendUserId) { const client = await accounts.asUser(backendUserId); return client.ok ? joined(client.value) : client; },
    async room(user, id, subjectUserId) { const facts = await room(user, id); return facts.ok ? success(roomView(facts.value, subjectUserId)) : facts; },
    async membership(user, target, id) { const value = await membership(user, target, id); return value.ok ? success(membershipView(value.value)) : value; },
    leave,
    async authorizeRoomAccess(authorizer, target, id, intent) {
      const facts = await room(authorizer, id);
      if (!facts.ok) return facts;
      const requested = requestedPower(facts.value, target, intent);
      return requested.ok ? success(roomView(facts.value, target)) : requested;
    },
    async invitation(backendUserId, roomId) {
      const target = await accounts.asUser(backendUserId);
      if (!target.ok) return target;
      const invitations = await invitationState(target.value, backendUserId);
      if (!invitations.ok) return invitations;
      const sender = invitations.value.get(roomId);
      if (!sender) return success(null);
      if (!sender.endsWith(':' + config.serverName)) return failure('forbidden', 'The native inviter must be a local Crossfire identity');
      const authorizer = await accounts.asUser(sender);
      return authorizer.ok ? invitationEvent(authorizer.value, backendUserId, roomId, sender) : authorizer;
    },
    async setRoomAccess(authorizerBackendUserId, targetBackendUserId, roomId, intent, admission) {
      const facts = await room(authorizerBackendUserId, roomId);
      if (!facts.ok) return facts;
      const current = await membership(authorizerBackendUserId, targetBackendUserId, roomId);
      if (!current.ok) return current;
      if (admission === null && current.value.membership !== 'join') return success(membershipView(current.value));
      const requested = requestedPower(facts.value, targetBackendUserId, intent, true);
      if (!requested.ok) return requested;
      const powerLevel = admission !== null || current.value.creator ? requested.value : Math.min(requested.value, current.value.powerLevel);
      const client = await accounts.asUser(authorizerBackendUserId);
      if (!client.ok) return client;
      const authorizedClient = client.value;
      const path = API + '/rooms/' + segment(roomId);
      async function verifyInvitation(): Promise<Result<void>> {
        if (admission?.kind !== 'invitation' || current.ok && current.value.membership === 'join') return success(undefined);
        if (admission.senderBackendUserId !== authorizerBackendUserId) return failure('forbidden', 'Native invitation authority does not match');
        const invitation = await invitationEvent(authorizedClient, targetBackendUserId, roomId, authorizerBackendUserId);
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
        const result = await nativeOk(client.value, 'PUT', path + '/state/m.room.power_levels', { ...powers.value, users: { ...users.value, [targetBackendUserId]: powerLevel } });
        if (!result.ok) return result;
      }
      if (current.value.membership !== 'join') {
        if (admission?.kind === 'managed') {
          const invited = await inviteToRoom(authorizerBackendUserId, roomId, targetBackendUserId);
          if (!invited.ok) return invited;
        } else {
          const currentInvitation = await verifyInvitation();
          if (!currentInvitation.ok) return currentInvitation;
        }
        const target = await accounts.asUser(targetBackendUserId);
        if (!target.ok) return target;
        const accepted = await nativeOk(target.value, 'POST', path + '/join', {});
        if (!accepted.ok) return accepted;
      }
      const checked = await membershipState(authorizerBackendUserId, targetBackendUserId, roomId);
      if (!checked.ok) return checked;
      const member = checked.value.member;
      if (member.membership !== 'join' || (member.creator ? intent.accessMode !== 'reply' : member.powerLevel !== powerLevel
        || intent.accessMode === 'reply' && member.powerLevel < checked.value.replyLevel || intent.accessMode === 'read' && member.powerLevel > checked.value.readLevel)) {
        return failure('native', 'Native room membership and requested permissions were not confirmed');
      }
      return success(membershipView(member));
    },
    async event(backendUserId, roomId, eventId) {
      const client = await accounts.asUser(backendUserId);
      if (!client.ok) return client;
      const result = await nativeOk(client.value, 'GET', API + '/rooms/' + segment(roomId) + '/event/' + segment(eventId));
      if (!result.ok) return result;
      try {
        if (result.value.event_id !== eventId) return failure('native', 'Invalid native event');
        const event = messageEvent(result.value as MatrixEvent, roomId);
        return success({ eventId, roomId, senderBackendUserId: event.sender, type: event.type, messageType: event.content.kind,
          body: event.content.body, mentions: event.content.mentions, edited: event.content.edited, control: event.content.control });
      } catch { return failure('native', 'Invalid Matrix event identity or content'); }
    },
    async sendNotice(backendUserId, roomId, transactionId, body, senderBackendUserId) {
      const client = await accounts.asUser(backendUserId);
      if (!client.ok) return client;
      const result = await nativeRequest(client.value, 'PUT', API + '/rooms/' + segment(roomId) + '/send/m.room.message/' + segment(transactionId),
        { msgtype: 'm.notice', body, 'm.mentions': { user_ids: [senderBackendUserId] }, [NOTICE_MARKER]: true });
      if (!result.ok) return result;
      if (result.value.status === 403) return failure('forbidden', 'Native room rules do not permit this notice');
      return result.value.status === 200 && typeof result.value.body.event_id === 'string' ? success(result.value.body.event_id) : failure('native', 'Notice publication remains unconfirmed');
    },
  };
}
