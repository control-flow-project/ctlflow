import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createHttpServer } from '../apps/server/src/http/create-server.js';
import { applicationFixture, secret } from './support/application.js';
import { contractRelease } from './support/release.js';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { bind } from '../apps/server/src/http/bind.js';
import { success } from '@ctlflow/crossfire-kernel/result';

test('operation declarations match exactly one current path and validate parameters', async () => {
  for (const operation of Object.values(operations)) {
    const endpoint = bind<unknown, unknown, unknown, unknown>(operation, () => success({ data: {} }));
    const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(
      key === 'roomId' ? '!opaque:server' : key === 'eventId' ? '$opaque' : key === 'fleetKey' ? 'research' : randomUUID()));
    assert(endpoint.match(path), operation.path);
    assert.equal(endpoint.match(path + '/suffix'), null);
  }
});

test('canonical HTTP has scoped REST resources, strict envelopes, CSRF and no credential leakage', async scope => {
  const fixture = await applicationFixture(scope);
  const release = contractRelease();
  const server = createHttpServer(fixture.application, { wake() {}, drain: async () => {}, stop: async () => {} }, release);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  fixture.application.config.publicOrigin = origin;
  fixture.services.instance.publicOrigin = origin;
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function request(path: string, method = 'GET', input?: unknown, headers: Record<string, string> = {}) {
    return fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(10_000) });
  }
  for (const path of ['/_coord/agents', '/_coord/health', '/api/managed-rooms', '/api/session', '/api/rooms/anything']) {
    assert.equal((await request(path)).status, path === '/api/rooms/anything' ? 401 : 404, path);
  }
  assert.equal((await request('/api/agents')).status, 401);
  assert.equal((await request('/api/sessions', 'POST', { nativeAccessToken: fixture.admin.token })).status, 403);
  const login = await request('/api/sessions', 'POST', { nativeAccessToken: fixture.admin.token }, { Origin: origin });
  assert.equal(login.status, 201, await login.clone().text());
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  const session = await login.json() as { data: { csrfSecret: string; member: { memberId: string } }; meta: { requestId: string } };
  assert.equal(session.data.member.memberId, fixture.admin.actor.principalId);
  assert.match(session.meta.requestId, /^[a-f0-9-]{36}$/u);
  const headers = { Cookie: cookie, Origin: origin, 'X-Crossfire-CSRF': session.data.csrfSecret };
  assert.equal((await request('/api/member-invitations', 'POST', { roleCode: 'member', expiresSeconds: 60 }, { Cookie: cookie, Origin: origin })).status, 403);
  assert.equal((await request('/api/agents?after=old', 'GET', undefined, headers)).status, 400);
  assert.equal((await request('/api/agents?pageSize=1&pageSize=2', 'GET', undefined, headers)).status, 400);
  assert.equal((await request('/api/enrollments/preflight', 'GET', undefined, headers)).status, 405);
  const invited = await request('/api/member-invitations', 'POST', { roleCode: 'member', expiresSeconds: 600 }, headers);
  assert.equal(invited.status, 201, await invited.clone().text());
  const invitation = await invited.json() as { data: { invitationId: string; claimSecret: string } };
  const listed = await request('/api/member-invitations', 'GET', undefined, headers);
  assert.equal(listed.status, 200);
  const content = await listed.text();
  assert(!content.includes(invitation.data.claimSecret) && !content.includes('claimHash') && !content.includes('nativeAccessToken'));
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: fixture.application.config.administrator,
    fleetKey: 'research', controller: { name: 'desktop' }, instances: [{ instanceKey: 'analyst', name: 'analyst', coordinationPolicy: defaultCoordinationPolicy(fixture.application.config.administrator) }] };
  const introduced = await request('/api/enrollments', 'POST', input);
  assert.equal(introduced.status, 201, await introduced.clone().text());
  const intro = await introduced.json() as { data: { enrollment: { enrollment: { verificationCode: string } }; approvalUrl: string } };
  assert.equal(intro.data.approvalUrl, origin + '/manage/enrollments/' + input.enrollmentId);
  assert.equal((await request('/api/enrollments/' + input.enrollmentId + '/decision', 'POST', {
    expectedRevision: 0, decision: 'approve', verificationCode: intro.data.enrollment.enrollment.verificationCode,
  }, headers)).status, 202);
  const agentPage = await request('/api/agents?page=1&pageSize=1', 'GET', undefined, headers);
  assert.equal(agentPage.status, 200, await agentPage.clone().text());
  const agents = await agentPage.json() as { data: { agentId: string }[]; meta: { totalItems: number; totalPages: number } };
  assert.equal(agents.meta.totalItems, 1);
  assert.equal(agents.meta.totalPages, 1);
  assert(agents.data[0]?.agentId);
  assert.equal((await request('/api/agents/' + agents.data[0]!.agentId, 'PATCH', { revision: 0, status: 'suspended' }, headers)).status, 400);
  const outsider = await fixture.member('outsider');
  const outsiderCookie = '__Host-crossfire=' + outsider.secret;
  const hidden = await request('/api/agents/' + agents.data[0]!.agentId, 'GET', undefined, { Cookie: outsiderCookie });
  assert.equal(hidden.status, 404);
  const memberPage = await request('/api/agents', 'GET', undefined, { Cookie: outsiderCookie });
  assert.equal(memberPage.status, 200);
  assert.equal((await memberPage.json() as { meta: { totalItems: number } }).meta.totalItems, 0);
  assert.equal((await request('/api/sessions/current', 'DELETE', {}, headers)).status, 200);
  assert.equal((await request('/api/sessions/current', 'GET', undefined, headers)).status, 401);
});
