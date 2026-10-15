import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contractRelease } from './support/release.js';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { readActivity } from '@ctlflow/crossfire-domain/listener/activity';
import { changeFleetDelivery } from '@ctlflow/crossfire-domain/fleet/control';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { heartbeat } from '@ctlflow/crossfire-contracts/schema/request';

test('listener activity counts cumulative receipts once and excludes offline gaps and stopped runs', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'activity'), run = randomUUID(), another = randomUUID(), release = '0.1.0-test';
  const activity = () => value(readActivity(services, [agent.id])).get(agent.id)!;
  const beat = (runId: string, messagesDelivered: number, stopped = false) => reportListener(services, agent.actor, agent.id, runId, { statistics: null, release, messagesDelivered, stopped, controller: agent.controller }, release);
  assert.equal(activity().status, 'offline');
  value(beat(run, 2)); fixture.advanceConnected(30_000, agent.controller); value(beat(run, 3)); value(beat(run, 1));
  assert.equal(activity().messagesDelivered, 3); assert.equal(activity().activeMs, 30_000);
  fixture.advanceConnected(90_001, agent.controller); assert.equal(activity().status, 'offline');
  value(beat(run, 4)); assert.equal(activity().activeMs, 30_000);
  value(beat(another, 3)); assert.equal(activity().activeRuns.length, 2);
  const fleet = value(services.repositories.fleet.findById(agent.controller.fleetId))!;
  value(changeFleetDelivery(services, admin.actor, fleet.id, { expectedRevision: fleet.revision, enabled: false }, randomUUID()));
  assert.equal(activity().status, 'offline'); assert.equal(value(beat(run, 4)).disconnect, true);
  value(beat(run, 4, true)); value(beat(another, 3, true));
  assert.equal(activity().status, 'offline'); value(beat(run, 999)); assert.equal(activity().messagesDelivered, 7);
  const paused = value(services.repositories.fleet.findById(fleet.id))!;
  value(changeFleetDelivery(services, admin.actor, fleet.id, { expectedRevision: paused.revision, enabled: true }, randomUUID()));
  const fresh = randomUUID(); value(beat(fresh, 0)); assert.equal(activity().status, 'online');
  value(changeAgent(services, admin.actor, agent.id, { expectedRevision: value(services.directory.agent(agent.id))!.principal.revision, status: 'suspended' }, randomUUID()));
  assert.equal(beat(fresh, 0).ok, false);
  for (const input of [{}, { release, messagesDelivered: 0, stopped: false }, { statistics: null, release, messagesDelivered: -1, controller: agent.controller, stopped: false }, { statistics: null, release, messagesDelivered: 1.5, controller: agent.controller, stopped: false }, { statistics: null, release, messagesDelivered: 0, controller: agent.controller, stopped: false, extra: true }]) assert.equal(heartbeat(input).ok, false);
});

test('listener version is immutable per run and current software is mandatory on registration', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'version'), run = randomUUID();
  const input = { statistics: null, release: 'old', messagesDelivered: 7, controller: agent.controller, stopped: false };
  assert.equal(reportListener(fixture.services, agent.actor, agent.id, run, input, 'new').ok, false);
  value(reportListener(fixture.services, agent.actor, agent.id, run, input, 'old'));
  value(reportListener(fixture.services, agent.actor, agent.id, run, input, 'new'));
  assert.equal(reportListener(fixture.services, agent.actor, agent.id, run, { ...input, release: 'new' }, 'new').ok, false);
  assert.equal(value(fixture.services.repositories.listenerRun.find({ id: run }))?.release, 'old');
  value(reportListener(fixture.services, agent.actor, agent.id, run, { ...input, controller: agent.controller, stopped: true }, 'new'));
  assert.equal(value(reportListener(fixture.services, agent.actor, agent.id, run, input, 'new')).disconnect, true);
});

test('HTTP heartbeat binds native identity and controller; delivery intent requires owner/admin, revision and CSRF', async scope => {
  const fixture = await applicationFixture(scope), { request, origin, headers } = await httpFixture(scope, fixture.application);
  const owner = await fixture.member('owner'), other = await fixture.member('other'), agent = await fixture.agent(owner.actor, 'listener');
  const run = randomUUID(), path = '/api/agents/' + agent.id, input = { statistics: null, release: contractRelease().manifest.release, messagesDelivered: 0, controller: agent.controller, stopped: false };
  for (const token of ['bad', owner.token, other.token]) assert.notEqual((await request(path + '/listener-runs/' + run, 'PUT', input, { Authorization: 'Bearer ' + token })).status, 200);
  const auth = { Authorization: 'Bearer ' + agent.token };
  assert.equal((await request(path + '/listener-runs/' + run, 'PUT', input, { ...auth, Cookie: '__Host-crossfire=' + owner.secret })).status, 400);
  assert.equal((await request(path + '/listener-runs/' + run, 'PUT', input, { ...auth, Origin: 'https://wrong.invalid' })).status, 403);
  assert.equal((await request(path + '/listener-runs/' + run, 'PUT', input, auth)).status, 200);
  assert.equal((await request(path + '/listener-disconnections', 'POST', { expectedRevision: 0, runIds: [run] }, headers(owner))).status, 404);
  const stop = { expectedRevision: value(fixture.services.repositories.fleet.findById(agent.controller.fleetId))!.revision, enabled: false }, delivery = '/api/fleets/' + agent.controller.fleetId + '/delivery';
  assert.equal((await request(delivery, 'PUT', stop, auth)).status, 401);
  assert.equal((await request(delivery, 'PUT', stop, { Cookie: '__Host-crossfire=' + owner.secret, Origin: origin })).status, 403);
  assert.equal((await request(delivery, 'PUT', stop, headers(other))).status, 403);
  assert.equal((await request(delivery, 'PUT', stop, headers(owner))).status, 200);
  const result = await request(path + '/listener-runs/' + run, 'PUT', input, auth);
  assert.equal((await result.json() as { data: { disconnect: boolean } }).data.disconnect, true);
});
