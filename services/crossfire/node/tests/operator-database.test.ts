import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { SCHEMA_VERSION } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import type { EnrollmentIntroduction } from '@ctlflow/crossfire-domain/enrollment/input';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { recordNativeStop } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { applicationFixture, value, secret } from './support/application.js';
import { inspectDatabase, verifyPreservation, databaseExpectations } from '../tools/database.js';

test('operator database inspection is readonly, complete and proves protected records across upgrades', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-database-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const current = join(directory, 'current.sqlite'), before = join(directory, 'before.sqlite');
  const fixture = await applicationFixture(scope, current);
  const agent = await fixture.agent(fixture.admin.actor, 'helper');
  const fleet = value(fixture.services.repositories.fleet.findById(agent.controller.fleetId))!;
  const request: EnrollmentIntroduction = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: fixture.admin.member.principal.backendUserId,
    fleetKey: fleet.fleetKey, controllerCredential: agent.controller.credential, controller: { name: 'laptop' }, instances: [{ instanceKey: 'helper', name: 'helper',
      identity: { agentId: agent.id, accessToken: agent.token }, coordinationPolicy: {
        wakeMode: 'selected' as const, senders: [], permissions: ['room.agent.invite'],
      } }] };
  const introduced = value(await introduceEnrollment(fixture.services, request));
  value(decideEnrollment(fixture.services, fixture.admin.actor, request.enrollmentId, {
    expectedRevision: introduced.request.revision, verificationCode: introduced.request.verificationCode, decision: 'approve',
  }, randomUUID()));
  const snapshot = new Database(current, { readonly: true, fileMustExist: true });
  try { await snapshot.backup(before); } finally { snapshot.close(); }
  chmodSync(before, 0o600);
  const bytes = readFileSync(current);
  const report = value(inspectDatabase(current, { schemaVersion: SCHEMA_VERSION, counts: { agent: 1, management_conversation: 0, fleet_instance_permission: 1 } }, true));
  assert.equal(Object.keys(report.counts).length, 57);
  assert.equal(report.schema?.length, 57);
  assert.equal(report.integrity, 'ok');
  assert(!JSON.stringify(report).includes(agent.token));
  assert.deepEqual(readFileSync(current), bytes);
  assert.equal(inspectDatabase(current, { schemaVersion: 7 }, false).ok, false);
  assert.equal(inspectDatabase(current, { counts: { agent: 0 } }, false).ok, false);
  assert.equal(databaseExpectations({ counts: { 'agent; DROP TABLE agent': 1 } }).ok, false);
  const preserved = value((await verifyPreservation(before, current)));
  assert.equal(preserved.preserved.agent, 1); assert.equal(preserved.preserved.agent_credential, 1);
  assert.equal(preserved.preserved.fleet_instance_policy, 1); assert.equal(preserved.preserved.enrollment_item_permission, 1);
  await fixture.member('additional');
  assert((await verifyPreservation(before, current)).ok, 'New records may be added without losing existing records');
  const database = new Database(current);
  try {
    executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_instance_permission').where(row => row.agent_id === params.id), { id: agent.id });
    assert.equal((await verifyPreservation(before, current)).ok, false, 'Approved future delegation is protected operator state');
    executeUpdate(database, schema, (query, params) => query.update('agent').set({ wake_mode: 'everyone' }).where(row => row.principal_id === params.id), { id: agent.id });
  }
  finally { database.close(); }
  assert.equal((await verifyPreservation(before, current)).ok, false);
  const linked = join(directory, 'linked.sqlite'); symlinkSync(current, linked);
  assert.equal(inspectDatabase(linked, {}, false).ok, false);
  chmodSync(before, 0o644); assert.equal(inspectDatabase(before, {}, false).ok, false);
  assert.equal(inspectDatabase(join(directory, 'missing.sqlite'), {}, false).ok, false);
});

test('operator preservation covers current enrollment and exact native-stop evidence without disclosing private bytes', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-database-history-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const current = join(directory, 'current.sqlite'), before = join(directory, 'before.sqlite');
  const fixture = await applicationFixture(scope, current), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'retained');
  const { runId } = fixture.listen(agent);
  value(reportListener(services, agent.actor, agent.id, runId,
    { release: 'test', messagesDelivered: 0, stopped: true, controller: agent.controller, statistics: null }, 'test'));
  const receiptId = randomUUID();
  value(recordNativeStop(services, value(authenticateController(services, agent.controller.credential)), agent.controller.fleetId,
    agent.id, { connectionId: agent.controller.connectionId, runId, receiptId }));
  const database = new Database(current);
  try {
    await database.backup(before); chmodSync(before, 0o600);
    const relationNames = ['enrollment_request', 'enrollment_item', 'enrollment_item_policy', 'fleet_native_stop'] as const;
    const bytes = readFileSync(current), report = value(inspectDatabase(current, {
      schemaVersion: SCHEMA_VERSION, counts: Object.fromEntries(relationNames.map(name => [name, 1])),
    }, true));
    assert.equal(Object.keys(report.counts).length, 57); assert.deepEqual(readFileSync(current), bytes);
    for (const privateText of [agent.token, agent.controller.credential])
      assert.equal(JSON.stringify(report).includes(privateText), false);
    const preserved = value((await verifyPreservation(before, current)));
    for (const name of relationNames) assert.equal(preserved.preserved[name], 1, name);
    executeUpdate(database, schema, (query, params) => query.update('fleet_native_stop').set({ invalidated_at: params.now })
      .where(row => row.agent_id === params.agentId && row.receipt_id === params.receiptId),
    { agentId: agent.id, receiptId, now: fixture.now() });
    assert.equal((await verifyPreservation(before, current)).ok, false, 'Changed native-stop authority must fail preservation');
  } finally { database.close(); }
});
