import { matrixPublicRoutes } from '@ctlflow/crossfire-adapter-matrix/web/router';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { publicRouter } from '../apps/server/src/router.js';
import { browserFailureMessage, verifyBrowser } from '../tools/browser/verify.js';
import { managementViews, managementViewports } from '../tools/browser/views.js';
import { createClient } from '@ctlflow/crossfire-client/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { operatorFixture } from './support/operator.js';
import { value } from './support/application.js';
import { secureRouter, browserExecutable } from '@ctlflow/crossfire-test-support/tls';

test('browser diagnostics redact complete credentials before bounding output, including a cutoff-crossing secret', () => {
  const prefix = 'x'.repeat(8100), secret = 'sensitive'.repeat(32);
  assert.equal(browserFailureMessage(new Error(prefix + secret + ' end'), [undefined, '', secret]), prefix + '[redacted] end');
  assert.equal(browserFailureMessage(new Error('x'.repeat(9000)), []).length, 8192);
  assert.equal(browserFailureMessage('untrusted message', []), 'Unknown browser verification failure');
});

test('operator browser captures native login before navigation, checks real views and logs out both sessions', { timeout: 120000 }, async scope => {
  const fixture = await operatorFixture(scope);
  const agent = await fixture.agent(fixture.admin.actor, 'helper');
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-operator-browser-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const routes = { publicOrigin: 'http://127.0.0.1', matrixOrigin: fixture.origin, service: fixture.server,
    web: join(process.cwd(), 'dist/web'), element: join(process.cwd(), 'dist/web') };
  const { origin } = await secureRouter(scope, publicRouter({ get publicOrigin() { return routes.publicOrigin; }, service: routes.service, web: routes.web, backend: matrixPublicRoutes(routes) }));
  routes.publicOrigin = origin;
  fixture.application.config.publicOrigin = origin;
  fixture.services.instance.publicOrigin = origin;
  const client = createClient({ origin, fetch: (url, options) => {
    const headers = new Headers(options?.headers); headers.set('Cookie', '__Host-crossfire=' + fixture.admin.secret);
    return fetch(url, { ...options, headers });
  } });
  const viewer = value(await client.call(operations.currentSession, {}, {})).data;
  const policy = value(await client.call(operations.policy, {}, {})).data;
  const agentView = value(await client.call(operations.agent, { agentId: agent.id }, {})).data;
  const fleetView = value(await client.call(operations.fleet, { fleetId: agent.controller.fleetId }, {})).data;
  const views = managementViews(viewer, policy, [agentView], [fleetView]);
  assert.deepEqual(views.map(view => view.route), [
    '/manage/agents', '/manage/fleets', '/manage/wake-ups', '/manage/wake-ups/new', '/manage/connect', '/manage/enrollments', '/manage/audit', '/manage/reports',
    '/manage/members', '/manage/policy', '/manage/invitations',
    '/manage/fleets/' + fleetView.fleetId, '/manage/fleets/' + fleetView.fleetId + '/map', '/manage/fleets/' + fleetView.fleetId + '/sessions', '/manage/fleets/' + fleetView.fleetId + '/activity',
    '/manage/fleets/' + fleetView.fleetId + '/activity?view=traffic', '/manage/fleets/' + fleetView.fleetId + '/settings',
    '/manage/agents/' + agent.id, '/manage/agents/' + agent.id + '/session', '/manage/agents/' + agent.id + '/activity', '/manage/agents/' + agent.id + '/settings', '/manage/agents/' + agent.id + '/wake',
  ]);
  const member = { ...viewer, member: { ...viewer.member, roleCode: 'member' as const } };
  const memberRoutes = managementViews(member, { ...policy, invitationIssuers: 'administrators' }, [], []).map(view => view.route);
  assert.deepEqual(memberRoutes, ['/manage/agents', '/manage/fleets', '/manage/wake-ups', '/manage/wake-ups/new', '/manage/connect', '/manage/enrollments', '/manage/audit', '/manage/reports']);
  assert(managementViews(member, { ...policy, invitationIssuers: 'members' }, [], []).some(view => view.route === '/manage/invitations'));
  assert(!managementViews({ ...member, permissions: [] }, policy, [], []).some(view => view.route === '/manage/reports'));
  const observed = await verifyBrowser(origin, fixture.account, browserExecutable(scope), directory, new AbortController().signal);
  if (!observed.ok && existsSync(join(directory, 'failure.json'))) scope.diagnostic(readFileSync(join(directory, 'failure.json'), 'utf8'));
  const report = value(observed);
  assert.equal(report.human, fixture.account.backendUserId);
  assert.equal(report.managementRoutes, views.length * managementViewports.length);
  assert.equal(report.wakePickerViewports, 2);
  assert.equal(report.modelCalls, 0);
  assert.equal(fixture.requests.filter(request => request.method === 'DELETE' && request.path === '/api/sessions/current').length, 2);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/logout')).length, 2);
  assert.equal(fixture.native.rooms.size, 0);
});
