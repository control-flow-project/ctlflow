import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { connectOwnerConversation } from '@crossfire/domain/owner-conversation/connect';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { deliveryPolicy } from '@crossfire/domain/agent/delivery-policy';
import { nativeApplication } from './support/native-application.js';
import { httpFixture } from './support/http.js';
import { value } from './support/application.js';

test('native enrollment, account data, membership, reply repair and reconnect use one private owner DM', { timeout: 180000 }, async scope => {
  const fixture = await nativeApplication(scope), { services, admin } = fixture;
  const agents = await Promise.all(['ada', 'jo'].map(name => fixture.agent(admin.actor, name)));
  const native = (token: string, method: string, path: string, body?: unknown) => nativeOk({ base: fixture.native.base, token }, method, API + path, body);
  const ownerId = admin.member.principal.matrixUserId;
  const direct = value(await native(admin.token, 'GET', '/user/' + segment(ownerId) + '/account_data/m.direct'));
  for (const agent of agents) {
    const bound = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
    assert.deepEqual(direct[agent.matrixUserId], [bound.roomId]);
    const base = '/rooms/' + segment(bound.roomId);
    const members = value(await native(admin.token, 'GET', base + '/joined_members')).joined;
    assert(members && typeof members === 'object' && !Array.isArray(members));
    assert.deepEqual(Object.keys(members).sort(), [ownerId, agent.matrixUserId].sort());
    const rules = value(await native(admin.token, 'GET', base + '/state/m.room.join_rules'));
    assert.equal(rules.join_rule, 'invite');
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
