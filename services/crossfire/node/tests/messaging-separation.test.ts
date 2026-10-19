import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { success, failure } from '@ctlflow/crossfire-kernel/result';
import type { MessagingAuthority, RoomFacts, RoomMembership } from '@ctlflow/crossfire-domain/port/messaging';
import type { MessageEvent, MessagingClient } from '@ctlflow/crossfire-domain/port/messaging-client';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { createMemberInvitation } from '@ctlflow/crossfire-domain/member/invitation';
import { acceptMemberInvitation } from '@ctlflow/crossfire-domain/member/accept-invitation';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { readUnread, eventView } from '@ctlflow/crossfire-agent-core/receive';
import { mentionsAgent } from '@ctlflow/crossfire-contracts/notices';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { createApplication } from '../apps/server/src/composition.js';
import { applicationDatabase } from './support/storage.js';
import { httpFixture } from './support/http.js';
import { temporary } from '../scripts/test-support/listener.js';
import { value, secret } from './support/application.js';

function backendFixture() {
  const accounts = new Map<string, { token: string; password: string; name: string }>();
  const members = new Map<string, Map<string, RoomMembership>>();
  const room = (user: string, roomId: string): RoomFacts => ({ roomId, backendUserId: user, name: roomId, topic: '', alias: null,
    canInvite: true, authorityRevision: 'opaque-revision', accessModes: ['read', 'reply', 'custom'], accessFields: [],
    permissions: [{ action: 'invite-collaborator', label: 'Invite a collaborator', allowed: true }] });
  const authority: MessagingAuthority = {
    describe: origin => ({ type: 'fixture', label: 'Independent test channel', chatUrl: origin + '/chat', signupUrl: origin + '/signup',
      signupInstructions: ['Use the test channel.'], configuration: { type: 'fixture', parameters: { tenant: 'opaque' } } }),
    authenticate: async (user, password) => accounts.get(user)?.password === password
      ? success(accounts.get(user)!.token) : failure('unauthorized', 'Sign-in failed'),
    agentAccount: (userId, accessToken) => ({ userId, accessToken, native: { channel: 'fixture' } }),
    agentUserId: id => 'agent/' + id, serviceUserId: () => 'service', localLabel: user => 'Person ' + user,
    registrationUserId: input => success(input.username),
    identify: async token => {
      const found = [...accounts].find(([, account]) => account.token === token);
      return found ? success(found[0]) : failure('unauthorized', 'Unknown credential');
    },
    exists: async user => success(accounts.has(user)),
    provision: async (userId, password, native = {}) => {
      const account = accounts.get(userId) ?? { password, token: secret(), name: userId };
      if (account.password !== password) return failure('unauthorized', 'Wrong password');
      accounts.set(userId, account); return success({ userId, accessToken: account.token, native });
    },
    deactivate: async user => { accounts.delete(user); return success(undefined); },
    discard: async user => { accounts.delete(user); return success(undefined); },
    profileName: async user => success(accounts.get(user)?.name ?? null),
    setDisplayName: async (user, name) => { const account = accounts.get(user); if (!account) return failure('missing', 'Unknown user'); account.name = name; return success(undefined); },
    joined: async user => success([...members].filter(([, room]) => room.has(user)).map(([id]) => id)),
    ownerConversation: async () => failure('unavailable', 'This fixture has no private conversations'),
    verifyOwnerConversation: async () => failure('forbidden', 'Not a private conversation'),
    markDirect: async () => failure('unavailable', 'This fixture has no private conversations'),
    room: async (user, roomId) => success(room(user, roomId)),
    membership: async (_authorizer, user, roomId) => success(members.get(roomId)?.get(user)
      ?? { backendUserId: user, displayName: user, membership: 'leave', nativeAccess: null }),
    invitation: async () => success(null),
    authorizeRoomAccess: async (authorizer, _target, roomId) => success(room(authorizer, roomId)),
    setRoomAccess: async (_authorizer, user, roomId, intent) => {
      const entry: RoomMembership = { backendUserId: user, displayName: user, membership: 'join', nativeAccess: intent.nativeAccess };
      const joined = members.get(roomId) ?? new Map<string, RoomMembership>(); joined.set(user, entry); members.set(roomId, joined); return success(entry);
    },
    leave: async (user, roomId) => { members.get(roomId)?.delete(user); return success(undefined); },
    event: async () => failure('missing', 'No event was stored'),
    sendNotice: async () => failure('unavailable', 'This fixture does not publish notices'), close() {},
  };
  return authority;
}

test('management authentication, enrollment and room grants use opaque backend identities and access parameters', async scope => {
  const authority = backendFixture(), administrator = value(await authority.provision('__proto__', secret()));
  const application = createApplication(applicationDatabase(scope), { instance: 'test', administrator: administrator.userId,
    publicOrigin: 'http://127.0.0.1', contentOrigin: 'http://localhost', messaging: { type: 'fixture', parameters: { tenant: 'opaque' } } },
  { backend: () => ({ authority, http: () => () => async () => false }) });
  cleanup(scope, () => application.close());
  const { services } = application, session = value(await createSession(services, administrator.accessToken));
  const admin = value(await authenticateMember(services, session.secret)).actor;
  const http = await httpFixture(scope, application);
  const metadata = await http.request('/api/messaging-backend'); assert.equal(metadata.status, 200);
  const description = (await metadata.json() as { data: { type: string; chatUrl: string } }).data;
  assert.equal(description.type, 'fixture'); assert.equal(description.chatUrl, http.origin + '/chat');
  const invitation = value(createMemberInvitation(services, admin, { roleCode: 'member', expiresSeconds: 600 }, randomUUID()));
  const password = secret(), accepted = value(await acceptMemberInvitation(services, invitation.invitationId,
    { claimSecret: invitation.claimSecret, username: 'constructor', displayName: 'Reader', password }, randomUUID()));
  assert.equal(accepted.account.userId, 'constructor');
  const login = await http.request('/api/backend-authentication', 'POST', { username: 'constructor', password }, { Origin: http.origin });
  assert.equal(login.status, 200); assert.equal((await login.json() as { data: { accessToken: string } }).data.accessToken, accepted.account.accessToken);
  assert.equal((await http.request('/api/backend-authentication', 'POST', { username: 'constructor', password })).status, 403);
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: administrator.userId, fleetKey: 'research', controller: { name: 'Test controller' },
    instances: [{ instanceKey: 'analyst', name: 'analyst', coordinationPolicy: defaultCoordinationPolicy(administrator.userId) }] };
  const introduced = value(await introduceEnrollment(services, input));
  value(decideEnrollment(services, admin, input.enrollmentId,
    { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
  const item = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!;
  assert(item.agentId); value(await reconcilePrincipal(services, item.agentId));
  const enrolled = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  assert.equal(enrolled.instances[0]?.account?.userId, 'agent/' + item.agentId);
  const nativeAccess = { roles: ['reviewer'], scope: { project: 'credit' } };
  const revision = value(services.repositories.principal.find({ id: item.agentId }))!.revision;
  value(await changeRoomGrant(services, admin, { agentId: item.agentId, roomId: '__proto__', expectedRevision: revision,
    expectedGeneration: null, accessMode: 'custom', nativeAccess, muted: false }, randomUUID()));
  value(await reconcileRoomGrant(services, item.agentId, '__proto__'));
  assert.deepEqual(value(services.repositories.roomGrantApplication.find({ agentId: item.agentId, roomId: '__proto__' }))?.nativeAccess, nativeAccess);
});

test('listener acquisition and directed mentions do not inspect native identifiers or event attributes', async scope => {
  const directory = temporary(scope), file = directory + '/cursor.json', messages: MessageEvent[] = ['__proto__', 'constructor'].map(roomId => ({
    roomId, eventId: 'event/' + roomId, sender: 'person', type: 'message', subjectId: null, sentAt: 1,
    content: { kind: 'text', body: 'Quoted agent/name is not a mention', mentions: [], edited: false, control: false, attachments: [], attributes: { native: 'opaque' } },
  }));
  localState.write(file, Object.fromEntries(messages.map(event => [event.roomId, 'start'])));
  const client: MessagingClient = {
    identify: async () => 'agent/name', joinedRooms: async () => messages.map(event => event.roomId), joinedMembers: async () => ['person', 'agent/name'],
    synchronize: async () => ({ cursor: 'next', rooms: {}, invitations: [], departedRooms: [], resetRooms: [] }),
    history: async (roomId, request) => ({ events: request.from === 'start' ? messages.filter(event => event.roomId === roomId) : [],
      start: request.from ?? null, end: request.from === 'start' ? 'end' : null, requestedLimit: request.limit }),
    event: async (roomId, eventId) => { const event = messages.find(event => event.roomId === roomId && event.eventId === eventId); assert(event); return event; },
    roomState: async () => [], origins: async (_user, rooms) => Object.fromEntries(rooms.map(room => [room, { kind: 'room', name: room, alias: null }])),
    acknowledge: async () => { assert.fail('Acquisition must not acknowledge input'); },
    sendNotice: async () => { assert.fail('Acquisition must not publish output'); }, thinking: async () => { assert.fail('Acquisition must not publish thinking'); },
    verifyPrivateConversation: async () => failure('forbidden', 'Not private'), noticeFits: () => true, noticeChunks: body => [body],
  };
  const batch = await readUnread(localState, client, { instance: 'test', server: 'https://example.test', owner: 'person',
    backend: { type: 'fixture', parameters: {} }, maxUploadBytes: 1048576 }, file, 100);
  assert.deepEqual(batch.events.map(event => event.eventId), messages.map(event => event.eventId));
  assert.equal(Object.getPrototypeOf(batch.cursors), null);
  for (const event of messages) {
    assert.equal(mentionsAgent(event, 'agent/name'), false);
    const directed = { ...event, content: { ...event.content, mentions: ['agent/name'] } };
    assert.equal(mentionsAgent(directed, 'agent/name'), true);
    assert.equal(mentionsAgent({ ...directed, content: { ...directed.content, edited: true } }, 'agent/name'), false);
    assert.equal(mentionsAgent({ ...directed, content: { ...directed.content, control: true } }, 'agent/name'), false);
    assert.deepEqual(eventView(directed, directed.roomId).content.attributes, { native: 'opaque' });
  }
});
