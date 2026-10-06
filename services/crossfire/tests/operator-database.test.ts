import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, copyFileSync, readFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
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
  const request: EnrollmentIntroduction = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: fixture.admin.member.principal.matrixUserId,
    fleetKey: fleet.fleetKey, controllerCredential: agent.controller.credential, controller: { name: 'laptop' }, instances: [{ instanceKey: 'helper', name: 'helper',
      identity: { agentId: agent.id, accessToken: agent.token }, coordinationPolicy: {
        wakeMode: 'owner-agents' as const, senderMatrixIds: [], permissions: ['room.agent.invite'],
      } }] };
  const introduced = value(await introduceEnrollment(fixture.services, request));
  value(decideEnrollment(fixture.services, fixture.admin.actor, request.enrollmentId, {
    expectedRevision: introduced.request.revision, verificationCode: introduced.request.verificationCode, decision: 'approve',
  }, randomUUID()));
  copyFileSync(current, before);
  const bytes = readFileSync(current);
  const report = value(inspectDatabase(current, { schemaVersion: 13, counts: { agent: 1, management_conversation: 0, fleet_instance_permission: 1 } }, true));
  assert.equal(Object.keys(report.counts).length, 63);
  assert.equal(report.schema?.length, 63);
  assert.equal(report.integrity, 'ok');
  assert(!JSON.stringify(report).includes(agent.token));
  assert.deepEqual(readFileSync(current), bytes);
  assert.equal(inspectDatabase(current, { schemaVersion: 7 }, false).ok, false);
  assert.equal(inspectDatabase(current, { counts: { agent: 0 } }, false).ok, false);
  assert.equal(databaseExpectations({ counts: { 'agent; DROP TABLE agent': 1 } }).ok, false);
  const preserved = value(verifyPreservation(before, current));
  assert.equal(preserved.preserved.agent, 1); assert.equal(preserved.preserved.agent_credential, 1);
  assert.equal(preserved.preserved.fleet_instance_policy, 1); assert.equal(preserved.preserved.enrollment_item_permission, 1);
  await fixture.member('additional');
  assert(verifyPreservation(before, current).ok, 'New records may be added without losing existing records');
  const database = new Database(current);
  try {
    executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_instance_permission').where(row => row.agent_id === params.id), { id: agent.id });
    assert.equal(verifyPreservation(before, current).ok, false, 'Approved future delegation is protected operator state');
    executeUpdate(database, schema, (query, params) => query.update('agent').set({ wake_mode: 'everyone' }).where(row => row.principal_id === params.id), { id: agent.id });
  }
  finally { database.close(); }
  assert.equal(verifyPreservation(before, current).ok, false);
  const linked = join(directory, 'linked.sqlite'); symlinkSync(current, linked);
  assert.equal(inspectDatabase(linked, {}, false).ok, false);
  chmodSync(before, 0o644); assert.equal(inspectDatabase(before, {}, false).ok, false);
  assert.equal(inspectDatabase(join(directory, 'missing.sqlite'), {}, false).ok, false);
});

test('operator preservation covers immutable archived children and exact native-stop evidence without disclosing private bytes', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-database-history-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const current = join(directory, 'current.sqlite'), before = join(directory, 'before.sqlite');
  const fixture = await applicationFixture(scope, current), { services, admin } = fixture;
  const agent = await fixture.agent(admin.actor, 'historical');
  const { runId } = fixture.listen(agent);
  value(reportListener(services, agent.actor, agent.id, runId,
    { release: 'test', messagesDelivered: 0, stopped: true, controller: agent.controller, statistics: null }, 'test'));
  const receiptId = randomUUID();
  value(recordNativeStop(services, value(authenticateController(services, agent.controller.credential)), agent.controller.fleetId,
    agent.id, { connectionId: agent.controller.connectionId, runId, receiptId }));
  const record = { requestId: randomUUID(), ownerId: admin.actor.principalId, agentId: agent.id,
    claimHash: secret(), createdAt: fixture.now() - 1000, expiresAt: fixture.now() + 1000 };
  const database = new Database(current);
  try {
    database.transaction(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive').values({ id: params.requestId,
        owner_id: params.ownerId, controller_name: null, controller_credential_hash: null, fleet_key: null,
        verification_code: 'ARCHIVEDCODE', claim_hash: params.claimHash, roster_digest: 'archived-roster', status: 'approved',
        revision: 1, created_at: params.createdAt, expires_at: params.expiresAt, decided_by_member_id: params.ownerId, decided_at: params.createdAt }), record);
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_item').values({ request_id: params.requestId,
        instance_key: 'historical', requested_name: 'historical', outcome: 'existing', agent_id: params.agentId, failure_code: null }), record);
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_policy').values({ request_id: params.requestId,
        instance_key: 'historical', wake_mode: 'selected', expected_agent_revision: 0 }), record);
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_permission').values({ request_id: params.requestId,
        instance_key: 'historical', permission_code: 'room.agent.invite', grant_scope: 'agent_room' }), record);
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_wake_sender').values({ request_id: params.requestId,
        instance_key: 'historical', sender_principal_id: params.ownerId }), record);
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_metadata').values({ enrollment_id: params.requestId,
        key: 'private-label', value: 'Archived private metadata' }), record);
    }).immediate();
    copyFileSync(current, before);
    const relationNames = ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy', 'enrollment_archive_permission',
      'enrollment_archive_wake_sender', 'enrollment_archive_metadata', 'fleet_native_stop'] as const;
    const bytes = readFileSync(current), report = value(inspectDatabase(current, {
      schemaVersion: 13, counts: Object.fromEntries(relationNames.map(name => [name, 1])),
    }, true));
    assert.equal(Object.keys(report.counts).length, 63); assert.deepEqual(readFileSync(current), bytes);
    for (const privateText of [agent.token, agent.controller.credential, record.claimHash, 'Archived private metadata'])
      assert.equal(JSON.stringify(report).includes(privateText), false);
    const preserved = value(verifyPreservation(before, current));
    for (const name of relationNames) assert.equal(preserved.preserved[name], 1, name);
    executeUpdate(database, schema, (query, params) => query.update('fleet_native_stop').set({ invalidated_at: params.now })
      .where(row => row.agent_id === params.agentId && row.receipt_id === params.receiptId),
    { agentId: agent.id, receiptId, now: fixture.now() });
    assert.equal(verifyPreservation(before, current).ok, false, 'Changed native-stop authority must fail preservation');
  } finally { database.close(); }
});
