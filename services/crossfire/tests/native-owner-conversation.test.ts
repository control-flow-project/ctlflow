import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk, nativeRequest } from '@ctlflow/crossfire-adapter-matrix/http';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import { acceptRoomInvitation } from '@ctlflow/crossfire-domain/room-access/accept-invitation';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { nativeApplication } from './support/native-application.js';
import { httpFixture } from './support/http.js';
import { value } from './support/application.js';

test('native enrollment creates no chats; owner-first and approval-first DMs retain readable names, privacy and reply repair', { timeout: 180000 }, async scope => {
  const fixture = await nativeApplication(scope), { services, admin } = fixture;
  const agents = await Promise.all(['ada', 'jo', 'remy'].map(name => fixture.agent(admin.actor, name)));
  const native = (token: string, method: string, path: string, body?: unknown) => nativeOk({ base: fixture.native.base, token }, method, API + path, body);
  const ownerId = admin.member.principal.matrixUserId;
  for (const agent of agents) {
    assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
    assert.deepEqual(value(await services.matrix.joined(agent.matrixUserId)), []);
    value(await reconcilePrincipal(services, agent.id));
    assert.deepEqual(value(services.collection.roomGrants({ agentId: agent.id })), []);
  }
  assert.equal(value(await nativeRequest({ base: fixture.native.base, token: admin.token }, 'GET',
    API + '/user/' + segment(ownerId) + '/account_data/m.direct')).status, 404);
  value(await native(admin.token, 'PUT', '/user/' + segment(ownerId) + '/account_data/m.direct', { [ownerId]: [] }));
  for (const connected of await Promise.all([agents[0]!, agents[2]!].map(agent => connectOwnerConversation(services, agent.actor, agent.id)))) value(connected);
  const invited = agents[1]!;
  const created = value(await native(admin.token, 'POST', '/createRoom', { preset: 'private_chat', visibility: 'private',
    is_direct: true, invite: [invited.matrixUserId] }));
  assert(typeof created.room_id === 'string');
  assert.equal(value(await services.matrix.invitation(invited.matrixUserId, created.room_id))!.direct, true);
  assert.equal(value(await acceptRoomInvitation(services, invited.actor, invited.id, created.room_id, randomUUID())).accepted, true);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: invited.id }))!.roomId, created.room_id);
  const direct = value(await native(admin.token, 'GET', '/user/' + segment(ownerId) + '/account_data/m.direct'));
  assert.deepEqual(direct[ownerId], [], 'Unrelated direct-message account data is preserved');
  for (const agent of agents) {
    const bound = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
    assert.deepEqual(direct[agent.matrixUserId], [bound.roomId]);
    const base = '/rooms/' + segment(bound.roomId);
    const members = value(await native(admin.token, 'GET', base + '/joined_members')).joined;
    assert(members && typeof members === 'object' && !Array.isArray(members));
    assert.deepEqual(Object.keys(members).sort(), [ownerId, agent.matrixUserId].sort());
    const rules = value(await native(admin.token, 'GET', base + '/state/m.room.join_rules'));
    assert.equal(rules.join_rule, 'invite');
    const displayName = value(await native(admin.token, 'GET', '/profile/' + segment(agent.matrixUserId) + '/displayname')).displayname;
    assert.equal(value(await native(admin.token, 'GET', base + '/state/m.room.name')).name, displayName);
    const agentDirect = value(await native(agent.token, 'GET', '/user/' + segment(agent.matrixUserId) + '/account_data/m.direct'));
    assert.deepEqual(agentDirect[ownerId], [bound.roomId]);
    value(await native(admin.token, 'PUT', base + '/state/m.room.name', { name: 'Document review' }));
    value(await connectOwnerConversation(services, agent.actor, agent.id));
    assert.equal(value(await native(admin.token, 'GET', base + '/state/m.room.name')).name, 'Document review', 'Human titles are preserved');
    value(await native(admin.token, 'PUT', base + '/state/m.room.name', { name: '' }));
    value(await connectOwnerConversation(services, agent.actor, agent.id));
    assert.equal(value(await native(admin.token, 'GET', base + '/state/m.room.name')).name, displayName, 'Untitled conversations recover the native agent name');
    value(await native(admin.token, 'PUT', base + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Owner request' }));
    value(await native(agent.token, 'PUT', base + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Agent reply' }));
    const powers = value(await native(admin.token, 'GET', base + '/state/m.room.power_levels'));
    value(await native(admin.token, 'PUT', base + '/state/m.room.power_levels', { ...powers,
      users: { ...(powers.users as Record<string, unknown>), [agent.matrixUserId]: -1 } }));
    value(await reconcileRoomGrant(services, agent.id, bound.roomId));
    value(await native(agent.token, 'PUT', base + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Repaired native reply' }));
    value(await native(agent.token, 'POST', base + '/leave', {}));
    assert.equal(value(await connectOwnerConversation(services, agent.actor, agent.id)).roomId, bound.roomId);
    assert.deepEqual(value(await services.matrix.joined(agent.matrixUserId)), [bound.roomId]);
    assert.equal(value(deliveryPolicy(services, agent.actor, agent.id)).ownerConversation, bound.roomId);
  }
  const http = await httpFixture(scope, fixture.application), target = agents[0]!;
  const response = await http.request('/api/agents/' + target.id + '/owner-conversation', 'POST', {},
    { Authorization: 'Bearer ' + target.token });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await http.request('/api/agents/' + agents[1]!.id + '/owner-conversation', 'POST', {},
    { Authorization: 'Bearer ' + target.token })).status, 403);
});
