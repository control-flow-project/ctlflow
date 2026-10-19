import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { changeWakePolicy } from '@ctlflow/crossfire-domain/wake/change-policy';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { wakePolicy as requestPolicy } from '@ctlflow/crossfire-contracts/schema/request';
import { wakePolicy as responsePolicy } from '@ctlflow/crossfire-contracts/schema/response';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';

test('person and ownership group entries combine dynamically across owners without implicit owner access', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const first = await fixture.member('first'), second = await fixture.member('second');
  const receiver = await fixture.agent(admin.actor, 'receiver'), peer = await fixture.agent(admin.actor, 'peer');
  const firstAgent = await fixture.agent(first.actor, 'first-agent'), secondAgent = await fixture.agent(second.actor, 'second-agent');
  const current = () => value(services.directory.agent(receiver.id))!;
  const change = (senders: { principalId: string; includeAgents: boolean }[]) => value(changeWakePolicy(services, admin.actor, receiver.id,
    { expectedRevision: current().principal.revision, mode: 'selected', senders }, randomUUID()));
  const authors = () => value(deliveryPolicy(services, receiver.actor, receiver.id)).wake.senders;
  change([{ principalId: first.actor.principalId, includeAgents: true }, { principalId: second.actor.principalId, includeAgents: false }]);
  assert.deepEqual(authors(), [first.member.principal.backendUserId, firstAgent.backendUserId, second.member.principal.backendUserId].sort());
  const newFirstAgent = await fixture.agent(first.actor, 'new-first-agent');
  assert(authors().includes(newFirstAgent.backendUserId));
  assert(!authors().includes(admin.member.principal.backendUserId)); assert(!authors().includes(peer.backendUserId)); assert(!authors().includes(secondAgent.backendUserId));
  change([{ principalId: admin.actor.principalId, includeAgents: true }, { principalId: second.actor.principalId, includeAgents: true }]);
  assert.deepEqual(authors(), [admin.member.principal.backendUserId, peer.backendUserId, second.member.principal.backendUserId, secondAgent.backendUserId].sort());
  assert(!authors().includes(receiver.backendUserId));
  value(changeMember(services, admin.actor, second.actor.principalId, { expectedRevision: 0, status: 'suspended' }, randomUUID()));
  assert.deepEqual(authors(), [admin.member.principal.backendUserId, peer.backendUserId].sort());
  change([]); assert.deepEqual(authors(), []);
});

test('invalid additive entries and stale revisions leave the complete selection and revision unchanged', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const receiver = await fixture.agent(admin.actor, 'receiver'), peer = await fixture.agent(admin.actor, 'peer'), inactive = await fixture.member('inactive');
  value(changeMember(services, admin.actor, inactive.actor.principalId, { expectedRevision: 0, status: 'suspended' }, randomUUID()));
  const revision = value(services.directory.agent(receiver.id))!.principal.revision;
  const before = value(services.collection.wakeSenders({ agentId: receiver.id }));
  const input = { expectedRevision: revision, mode: 'selected' as const, senders: before.map(sender => ({ principalId: sender.senderPrincipalId, includeAgents: sender.includeAgents })) };
  for (const senders of [[{ principalId: receiver.id, includeAgents: false }], [{ principalId: peer.id, includeAgents: true }],
    [{ principalId: inactive.actor.principalId, includeAgents: true }], [{ principalId: randomUUID(), includeAgents: false }],
    [...input.senders, ...input.senders], Array.from({ length: 2001 }, () => ({ principalId: randomUUID(), includeAgents: false }))]) {
    assert(!changeWakePolicy(services, admin.actor, receiver.id, { ...input, senders }, randomUUID()).ok);
    assert.equal(value(services.directory.agent(receiver.id))!.principal.revision, revision);
    assert.deepEqual(value(services.collection.wakeSenders({ agentId: receiver.id })), before);
  }
  assert(!changeWakePolicy(services, admin.actor, receiver.id, { ...input, mode: 'everyone' }, randomUUID()).ok);
  assert(!changeWakePolicy(services, admin.actor, receiver.id, { ...input, expectedRevision: revision + 1 }, randomUUID()).ok);
  for (const invalid of [{ ...input, senderIds: [] }, { ...input, mode: 'owner-agents' }, { ...input, senders: [{ principalId: admin.actor.principalId, includeAgents: 1 }] },
    { ...input, senders: [{ principalId: admin.actor.principalId }] }, { ...input, senders: [{ principalId: admin.actor.principalId, includeAgents: false, extra: true }] }]) assert(!requestPolicy(invalid).ok);
});

test('canonical REST reads and writes structured selections with CSRF, ownership and exact revision checks', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const other = await fixture.member('other'), receiver = await fixture.agent(other.actor, 'receiver');
  const backend = await httpFixture(scope, fixture.application), path = '/api/agents/' + receiver.id + '/wake-policy';
  const initial = await backend.request(path, 'GET', undefined, backend.headers(other)); assert.equal(initial.status, 200);
  const body = await initial.json() as { data: unknown }, parsed = value(responsePolicy(body.data));
  assert.equal(parsed.senders[0]!.includeAgents, false); assert.equal(parsed.senders[0]!.identity.principalId, other.actor.principalId);
  const input = { expectedRevision: parsed.revision, mode: 'selected', senders: [
    { principalId: other.actor.principalId, includeAgents: true }, { principalId: admin.actor.principalId, includeAgents: false }] };
  assert.equal((await backend.request(path, 'PUT', input, { Cookie: '__Host-crossfire=' + other.secret, Origin: backend.origin })).status, 403);
  const saved = await backend.request(path, 'PUT', input, backend.headers(other)); assert.equal(saved.status, 200, await saved.clone().text());
  const response = value(responsePolicy((await saved.json() as { data: unknown }).data));
  assert.equal(response.revision, parsed.revision + 1); assert.equal(response.senders.length, 2);
  assert(response.senders.some(sender => sender.identity.principalId === other.actor.principalId && sender.includeAgents));
  assert.equal((await backend.request(path, 'PUT', input, backend.headers(other))).status, 409);
  assert.equal((await backend.request(path, 'PUT', { ...input, expectedRevision: response.revision, senderIds: [] }, backend.headers(other))).status, 400);
  assert.equal((await backend.request(path, 'GET', undefined, { Authorization: 'Bearer ' + receiver.token })).status, 200);
  const stranger = await fixture.member('stranger');
  assert.equal((await backend.request(path, 'PUT', { ...input, expectedRevision: response.revision }, backend.headers(stranger))).status, 404);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: receiver.id })), []);
});
