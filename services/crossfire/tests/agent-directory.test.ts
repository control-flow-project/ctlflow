import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contractRelease } from './support/release.js';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { reportListener } from '@crossfire/domain/listener/report';

test('REST agent filtering and paging preserve owner isolation; policy is admin-only', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, http = await httpFixture(scope, fixture.application);
  const alice = await fixture.member('alice'), bob = await fixture.member('bob');
  const agents = [];
  for (const [name, owner] of [['alice', alice], ['bob', bob]] as const) for (const status of ['active', 'suspended', 'revoked'] as const) {
    const agent = await fixture.agent(owner.actor, name + '-' + status); agents.push({ ...agent, status, owner });
    if (status !== 'active') value(changeAgent(services, owner.actor, agent.id, { expectedRevision: 0, status }, randomUUID()));
  }
  value(reportListener(services, agents[0]!.actor, agents[0]!.id, randomUUID(), { statistics: null, release: contractRelease().manifest.release, messagesDelivered: 1, controllerBound: false, stopped: false }, contractRelease().manifest.release));
  async function list(viewer: typeof alice, query = '') {
    const response = await http.request('/api/agents' + query, 'GET', undefined, http.headers(viewer));
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as { data: { agentId: string; owner: { memberId: string }; status: string }[]; meta: { totalItems: number; totalPages: number } };
  }
  assert.equal((await list(admin)).meta.totalItems, 4);
  assert.equal((await list(admin, '?status=active,suspended,revoked')).meta.totalItems, 6);
  for (const viewer of [alice, bob]) {
    const all = await list(viewer, '?status=active,suspended,revoked'); assert.equal(all.meta.totalItems, 3);
    assert(all.data.every(agent => agent.owner.memberId === viewer.actor.principalId));
  }
  assert.deepEqual((await list(admin, '?listener=online')).data.map(agent => agent.agentId), [agents[0]!.id]);
  assert.equal((await list(bob, '?listener=online')).meta.totalItems, 0);
  const first = await list(admin, '?status=suspended&pageSize=1'), second = await list(admin, '?status=suspended&pageSize=1&page=2');
  assert.equal(first.meta.totalPages, 2); assert.equal(first.data[0]!.status, 'suspended'); assert.notEqual(first.data[0]!.agentId, second.data[0]!.agentId);
  assert.equal((await list(admin, '?status=')).meta.totalItems, 0);
  for (const query of ['?status=all', '?status=active&status=revoked', '?listener=online&listener=offline', '?pageSize=1&pageSize=2', '?unknown=true']) assert.equal((await http.request('/api/agents' + query, 'GET', undefined, http.headers(alice))).status, 400);
  const { id: _id, revision, ...policy } = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  const update = { ...policy, expectedRevision: revision, agentInstructions: 'Administrator instruction.' };
  assert.equal((await http.request('/api/instance-policy', 'PATCH', update, http.headers(alice))).status, 403);
  assert.equal((await http.request('/api/instance-policy', 'PATCH', update, { ...http.headers(admin), 'X-Crossfire-CSRF': 'wrong' })).status, 403);
  assert.equal((await http.request('/api/instance-policy', 'PATCH', update, http.headers(admin))).status, 200);
  assert.equal((await http.request('/api/instance-policy', 'PATCH', update, http.headers(admin))).status, 409);
  assert.equal(value(services.repositories.instancePolicy.find({ id: 'instance' }))!.agentInstructions, update.agentInstructions);
});
