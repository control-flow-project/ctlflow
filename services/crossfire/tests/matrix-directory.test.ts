import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { applicationFixture, value, secret } from './support/application.js';
import { httpFixture } from './support/http.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { authenticateNativePrincipal, authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import type { MatrixDirectoryResult } from '@ctlflow/crossfire-contracts/matrix-directory';

const path = '/_matrix/client/v3/user_directory/search';
test('Matrix directory authenticates native principals, bounds searches and retains REST session authority', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const owner = await fixture.member('alice'), other = await fixture.member('bob');
  const agent = await fixture.agent(owner.actor, 'bea');
  const revision = () => value(services.repositories.principal.find({ id: agent.id }))!.revision;
  const { request, headers } = await httpFixture(scope, fixture.application);
  const search = (token: string, input: unknown = { search_term: 'bea' }, extra: Record<string, string> = {}) => request(path, 'POST', input, { Authorization: 'Bearer ' + token, ...extra });
  for (const token of [admin.token, owner.token, other.token, agent.token]) {
    const response = await search(token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [{ user_id: agent.matrixUserId, display_name: 'bea (alice)' }], limited: false });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await search(owner.token, { search_term: 'BEA' }, { Cookie: '__Host-crossfire=unrelated' })).status, 200, 'Element’s native authentication is independent of a management cookie');
  const exact = await search(other.token, { search_term: agent.matrixUserId });
  assert.equal((await exact.json() as MatrixDirectoryResult).results[0]?.user_id, agent.matrixUserId);
  assert.deepEqual(await (await search(owner.token, { search_term: 'absent' })).json(), { results: [], limited: false });
  assert.deepEqual(await (await search(owner.token, { search_term: '', limit: 0 })).json(), { results: [], limited: true });
  const limited = await (await search(owner.token, { search_term: '', limit: 1 })).json() as MatrixDirectoryResult;
  assert.equal(limited.results.length, 1); assert.equal(limited.limited, true);
  for (const input of [{ search_term: 'x', limit: 101 }, { search_term: 'x', limit: -1 }, { search_term: 'x', limit: 1.5 },
    { search_term: 'x', unexpected: true }, { search_term: 'x'.repeat(201) }, {}, null]) assert.equal((await search(owner.token, input)).status, 400);
  assert.equal((await request(path + '?access_token=' + owner.token, 'POST', { search_term: 'bea' })).status, 400);
  assert.equal((await request(path)).status, 405);
  assert.equal((await request(path, 'POST', { search_term: 'bea' }, headers(admin))).status, 401);
  assert.equal((await search('invalid')).status, 401);
  const unregistered = value(await services.matrix.provision('@stranger:test.localhost', secret(), 'fixture'));
  assert.equal((await search(unregistered.accessToken)).status, 403);
  assert.equal((await request('/api/members', 'GET', undefined, { Authorization: 'Bearer ' + owner.token })).status, 401);
  assert.equal((await request('/api/agents', 'GET', undefined, { Authorization: 'Bearer ' + owner.token })).status, 401);
  value(changeAgent(services, owner.actor, agent.id, { expectedRevision: revision(), displayName: 'Research Bea' }, randomUUID()));
  assert.equal((await (await search(owner.token, { search_term: 'research' })).json() as MatrixDirectoryResult).results[0]?.display_name, 'Research Bea');
  value(changeAgent(services, owner.actor, agent.id, { expectedRevision: revision(), status: 'suspended' }, randomUUID()));
  assert.equal((await search(agent.token)).status, 403);
  assert.deepEqual((await (await search(other.token)).json() as MatrixDirectoryResult).results, []);
  value(changeAgent(services, owner.actor, agent.id, { expectedRevision: revision(), status: 'active' }, randomUUID()));
  value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 0, status: 'suspended' }, randomUUID()));
  assert.equal((await search(owner.token)).status, 403); assert.equal((await search(agent.token)).status, 403);
  assert.deepEqual((await (await search(other.token)).json() as MatrixDirectoryResult).results, []);
  value(changeMember(services, admin.actor, owner.actor.principalId, { expectedRevision: 1, status: 'active' }, randomUUID()));
  const session = value(services.repositories.memberSession.find({ secretHash: services.identity.hash(owner.secret) }))!;
  fixture.advance(session.expiresAt - fixture.now() + 1);
  assert.equal((await authenticateMember(services, owner.secret)).ok, false);
  assert.equal((await authenticateNativePrincipal(services, owner.token)).ok, true, 'Native auth does not revive an expired management session');
  value(changeAgent(services, value(await authenticateNativePrincipal(services, owner.token)), agent.id, { expectedRevision: revision(), status: 'revoked' }, randomUUID()));
  assert.deepEqual((await (await search(other.token)).json() as MatrixDirectoryResult).results, []);
});

test('public Matrix directory routes identities through Crossfire without granting shared room membership', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture());
  const owner = await fixture.member('alice'), searcher = await fixture.member('bob'), agent = await fixture.agent(owner.actor, 'bea');
  const native = await fetch(fixture.native.base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + searcher.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ search_term: 'bea' }) });
  assert.equal(native.status, 200); assert.deepEqual((await native.json() as MatrixDirectoryResult).results, [], 'Preserve the actual native missing-discovery control');
  const response = await fetch(fixture.origin + path, { method: 'POST', headers: { Authorization: 'Bearer ' + searcher.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ search_term: 'bea', limit: 100 }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [{ user_id: agent.matrixUserId, display_name: 'bea (alice)' }], limited: false });
  const joined = await fetch(fixture.origin + API + '/joined_rooms', { headers: { Authorization: 'Bearer ' + agent.token } });
  assert.equal(value(fixture.services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  assert.equal(joined.status, 200); assert.deepEqual(await joined.json(), { joined_rooms: [] });
  assert.deepEqual(value(fixture.services.collection.roomGrants({ agentId: agent.id })), []);
});
