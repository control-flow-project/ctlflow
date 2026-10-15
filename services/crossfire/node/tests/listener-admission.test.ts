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
  assert.equal(admitsController(run, facts, 100), true);
  const denied: ControllerAdmissionFacts[] = [
    { ...facts, ownerStatus: 'suspended' }, { ...facts, ownerStatus: 'revoked' },
    { ...facts, binding: { ...facts.binding, retiredAt: 1 } },
    { ...facts, binding: { ...facts.binding, ownerId: 'foreign' } },
    { ...facts, binding: { ...facts.binding, fleetKey: 'foreign' } },
    { ...facts, fleet: { ...facts.fleet, id: 'foreign' } },
    { ...facts, fleet: { ...facts.fleet, archivedAt: 1 } },
    { ...facts, fleet: { ...facts.fleet, deliveryEnabled: false } },
    { ...facts, connection: { ...facts.connection, connectionId: 'replacement' } },
    { ...facts, connection: { ...facts.connection, credentialId: 'replacement' } },
    { ...facts, connection: { ...facts.connection, closedAt: 1 } },
    { ...facts, connection: { ...facts.connection, expiresAt: 100 } },
    { ...facts, credential: { ...facts.credential, fleetId: 'foreign' } },
    { ...facts, credential: { ...facts.credential, revokedAt: 1 } },
  ];
  for (const [index, deniedFacts] of denied.entries()) assert.equal(admitsController(run, deniedFacts, 100), false, 'Authority fence ' + index);
  assert.equal(admitsController(run, null, 100), false);
  assert.equal(admitsController({ controller: null }, facts, 100), false);
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
    assert.equal(value(controllerAdmission(services, run)), expected);
    const activity = value(readActivity(services, [agent.id, 'unknown']));
    assert.equal(activity.get(agent.id)?.status, expected ? 'online' : 'offline');
    assert.equal(activity.get('unknown')?.status, 'offline');
  };
  check(true);
  const changes = [
    { apply: () => repositories.fleet.update({ ...fleet, deliveryEnabled: false }), restore: () => repositories.fleet.update(fleet) },
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
