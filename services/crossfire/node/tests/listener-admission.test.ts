import assert from 'node:assert/strict';
import test from 'node:test';
import { admitsController, type ControllerAdmissionFacts } from '@ctlflow/crossfire-domain/listener/admission';
import { controllerAdmission } from '@ctlflow/crossfire-domain/listener/controller';
import { readActivity } from '@ctlflow/crossfire-domain/listener/activity';
import { applicationFixture, value } from './support/application.js';

test('the one pure controller admission predicate refuses every contradictory or missing authority fact', () => {
  const run = { controller: { fleetId: 'fleet', connectionId: 'connection', credentialId: 'credential' } };
  const facts: ControllerAdmissionFacts = { binding: { ownerId: 'owner', fleetKey: 'key', retiredAt: null },
    fleet: { id: 'fleet', ownerId: 'owner', fleetKey: 'key', archivedAt: null, deliveryEnabled: true },
    connection: { connectionId: 'connection', credentialId: 'credential', closedAt: null, expiresAt: 101 },
    credential: { fleetId: 'fleet', revokedAt: null }, ownerStatus: 'active' };
  for (const purpose of ['reporting', 'delivery'] as const) assert.equal(admitsController(run, facts, 100, purpose), true);
  const paused = { ...facts, fleet: { ...facts.fleet, deliveryEnabled: false } };
  assert.equal(admitsController(run, paused, 100, 'delivery'), false);
  assert.equal(admitsController(run, paused, 100, 'reporting'), true);
  const denied: ControllerAdmissionFacts[] = [
    { ...facts, ownerStatus: 'suspended' }, { ...facts, ownerStatus: 'revoked' },
    { ...facts, binding: { ...facts.binding, retiredAt: 1 } },
    { ...facts, binding: { ...facts.binding, ownerId: 'foreign' } },
    { ...facts, binding: { ...facts.binding, fleetKey: 'foreign' } },
    { ...facts, fleet: { ...facts.fleet, id: 'foreign' } },
    { ...facts, fleet: { ...facts.fleet, archivedAt: 1 } },
    { ...facts, connection: { ...facts.connection, connectionId: 'replacement' } },
    { ...facts, connection: { ...facts.connection, credentialId: 'replacement' } },
    { ...facts, connection: { ...facts.connection, closedAt: 1 } },
    { ...facts, connection: { ...facts.connection, expiresAt: 100 } },
    { ...facts, credential: { ...facts.credential, fleetId: 'foreign' } },
    { ...facts, credential: { ...facts.credential, revokedAt: 1 } },
  ];
  for (const purpose of ['reporting', 'delivery'] as const) {
    for (const [index, deniedFacts] of denied.entries()) assert.equal(admitsController(run, deniedFacts, 100, purpose), false, 'Authority fence ' + purpose + ':' + index);
    assert.equal(admitsController(run, null, 100, purpose), false);
    assert.equal(admitsController({ controller: null }, facts, 100, purpose), false);
  }
});

test('actual batch activity and single-run admission agree across persisted authority changes', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'batch-authority'), { runId } = fixture.listen(agent);
  const repositories = services.repositories;
  const run = value(repositories.listenerRun.find({ id: runId }))!;
  const fleet = value(repositories.fleet.findById(agent.controller.fleetId))!;
  const binding = value(repositories.fleetInstance.findByAgent(agent.id))!;
  const connection = value(repositories.fleetConnection.find(fleet.id))!;
  const credential = value(repositories.fleetCredential.find({ id: connection.credentialId }))!;
  const owner = value(repositories.principal.find({ id: fleet.ownerId }))!;
  const check = (expected: boolean) => {
    assert.equal(value(controllerAdmission(services, run, 'reporting')), expected);
    assert.equal(value(controllerAdmission(services, run, 'delivery')), expected);
    assert.equal(value(services.listenerRead.reportingAgentIds(fixture.now() - 90000, false, fixture.now())).includes(agent.id), expected);
    const activity = value(readActivity(services, [agent.id, 'unknown']));
    assert.equal(activity.get(agent.id)?.status, expected ? 'online' : 'offline');
    assert.equal(activity.get('unknown')?.status, 'offline');
  };
  check(true);
  value(repositories.fleet.update({ ...fleet, deliveryEnabled: false }));
  assert.equal(value(controllerAdmission(services, run, 'delivery')), false);
  assert.equal(value(controllerAdmission(services, run, 'reporting')), true);
  assert.equal(value(readActivity(services, [agent.id])).get(agent.id)?.status, 'online');
  assert.equal(value(services.listenerRead.reportingAgentIds(fixture.now() - 90000, false, fixture.now())).includes(agent.id), true);
  value(repositories.fleet.update(fleet));
  const changes = [
    { apply: () => repositories.fleet.update({ ...fleet, archivedAt: fixture.now() }), restore: () => repositories.fleet.update(fleet) },
    { apply: () => repositories.fleetInstance.update({ ...binding, retiredAt: fixture.now() }), restore: () => repositories.fleetInstance.update(binding) },
    { apply: () => repositories.principal.update({ ...owner, status: 'suspended' }), restore: () => repositories.principal.update(owner) },
    { apply: () => repositories.fleetCredential.update({ ...credential, revokedAt: fixture.now() }), restore: () => repositories.fleetCredential.update(credential) },
    { apply: () => repositories.fleetConnection.save({ ...connection, closedAt: fixture.now() }), restore: () => repositories.fleetConnection.save(connection) },
    { apply: () => repositories.fleetConnection.save({ ...connection, connectionId: 'replacement' }), restore: () => repositories.fleetConnection.save(connection) },
    { apply: () => repositories.fleetConnection.save({ ...connection, lastSeenAt: fixture.now() - 1, expiresAt: fixture.now() }), restore: () => repositories.fleetConnection.save(connection) },
  ];
  for (const change of changes) { value(change.apply()); check(false); value(change.restore()); check(true); }
  assert.deepEqual(value(services.listenerRead.admissionCandidates([], 0)), []);
});
