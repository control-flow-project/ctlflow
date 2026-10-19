import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeInsert, executeSelect, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { maintainLogging } from '@ctlflow/crossfire-domain/maintenance/logging';
import { DAY_MS, loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { readFleetStatistics } from '@ctlflow/crossfire-domain/fleet/read-statistics';
import { createDecision, answerDecision, receiptDecision } from '@ctlflow/crossfire-domain/runtime/decisions';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { createWakeRule } from '@ctlflow/crossfire-domain/wake-up/manage';
import { claimWake, acknowledgeWake } from '@ctlflow/crossfire-domain/wake-up/delivery';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { requestFleetRuntime, claimFleetRuntime, receiptFleetRuntime } from '@ctlflow/crossfire-domain/fleet/runtime';
import { createFleetMessage, acknowledgeFleetMessage } from '@ctlflow/crossfire-domain/fleet/message';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { recordNativeStop } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { createMemberInvitation } from '@ctlflow/crossfire-domain/member/invitation';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { verifyPreservation } from '../tools/database.js';
import { config } from '../apps/server/src/config.js';
import { applicationFixture, value, secret } from './support/application.js';

async function fixtureStore(scope: TestContext, days?: number) {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-retention-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const file = join(directory, 'management.sqlite');
  const fixture = await applicationFixture(scope, file, days === undefined ? {} : { loggingRetentionDays: days });
  const database = openTestStore(file); cleanup(scope, () => database.close());
  return { ...fixture, database, file };
}

test('one logging policy defaults to a week and refuses unsafe explicit configuration', async scope => {
  assert.equal(value(loggingRetentionDays()), 7);
  assert.equal(value(loggingRetentionDays(14)), 14);
  for (const invalid of [null, 0, -1, 0.5, '7', true, Infinity, NaN, Number.MAX_SAFE_INTEGER])
    assert.equal(loggingRetentionDays(invalid).ok, false, 'Reject invalid loggingRetentionDays');
  const fixture = await applicationFixture(scope);
  assert.equal(value(config(fixture.application.config)).loggingRetentionDays, 7);
  assert.equal(value(config({ ...fixture.application.config, loggingRetentionDays: 14 })).loggingRetentionDays, 14);
  assert.equal(config({ ...fixture.application.config, loggingRetentionDays: '7' }).ok, false);
  assert.equal(maintainLogging(fixture.services, 0).ok, false);
  assert.equal(maintainLogging(fixture.services, 1001).ok, false);
});

test('idle cleanup removes expired run/status/settings families but retains current state and exact history identity', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'retention');
  const past = fixture.listen(agent), sessionId = randomUUID(), original = fixture.now();
  value(fixture.services.runtime.saveObservation(agent.id, { ...past, sessionId, roomId: null, runtime: 'codex', state: 'idle', observedAt: original,
    historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, lastActivityAt: original, historyAvailable: true,
    settings: [{ name: 'model', configured: 'fixture-model', effective: 'fixture-model' }] }));
  fixture.advance(8 * DAY_MS); fixture.renewController(agent.controller);
  const current = fixture.listen(agent);
  value(fixture.services.runtime.saveObservation(agent.id, { ...current, sessionId, roomId: null, runtime: 'codex', state: 'sleeping', observedAt: fixture.now(),
    historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, lastActivityAt: original, historyAvailable: true,
    settings: [{ name: 'model', configured: 'fixture-model', effective: 'fixture-model' }] }));
  const result = value(maintainLogging(fixture.services)); assert(result.removed > 0);
  assert.equal(value(fixture.services.repositories.listenerRun.find({ id: past.runId })), null);
  assert.equal(executeSelect(fixture.database, schema, (query, params) => query.from('runtime_setting').where(row => row.run_id === params.id).count(), { id: past.runId }), 0);
  assert.equal(executeSelect(fixture.database, schema, (query, params) => query.from('runtime_observation').where(row => row.run_id === params.id).count(), { id: past.runId }), 0);
  assert(value(fixture.services.repositories.listenerRun.find({ id: current.runId })));
  assert.equal(value(fixture.services.runtime.observation(agent.id))[0]?.sessionId, sessionId);
  assert.equal(value(fixture.services.repositories.agentCredential.find({ agentId: agent.id }))?.accessToken, agent.token);
  assert.equal(executeSelect(fixture.database, schema, query => query.from('audit_event').count()), 0);
  assert.deepEqual(sqliteMetadata.foreignKeyViolations(fixture.database), []);
  assert.equal(sqliteMetadata.integrityResult(fixture.database), 'ok');
  fixture.advance(20 * DAY_MS); value(maintainLogging(fixture.services));
  assert(value(fixture.services.repositories.listenerRun.find({ id: current.runId })), 'The single current-state projection is not historical logging');
});

test('outstanding native questions and unsent owner notices retain their required records while unrelated history expires', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'questions');
  const run = fixture.listen(agent), decisionId = randomUUID(), incidentId = randomUUID();
  value(createDecision(fixture.services, agent.actor, agent.id, { id: decisionId, runId: run.runId, sessionId: 'native-history', runtime: 'codex', requestId: 'native-question',
    turnId: 'turn', itemId: 'item', kind: 'question', action: 'Choose', review: 'Owner decision', blocking: true, expiresAt: null,
    questions: [{ id: 'question', title: 'Continue?', prompt: 'Choose an option', secret: false, allowText: false,
      options: [{ id: 'yes', label: 'Yes', description: 'Continue' }, { id: 'no', label: 'No', description: 'Stop' }] }] }));
  value(fixture.services.runtime.insertIncident({ id: incidentId, ownerId: fixture.admin.actor.principalId, agentId: agent.id, fleetId: null,
    runId: run.runId, sessionId: 'native-history', kind: 'contact', message: 'Contact unavailable', createdAt: fixture.now(), recoveredAt: fixture.now() }));
  executeInsert(fixture.database, schema, (query, params) => query.insertInto('incident_notification').values({ incident_id: params.id,
    phase: 'initial', body: 'Owner notification', next_attempt_at: params.now, event_id: null }), { id: incidentId, now: fixture.now() });
  fixture.advance(8 * DAY_MS); fixture.renewController(agent.controller); fixture.listen(agent);
  value(maintainLogging(fixture.services));
  assert.equal(value(fixture.services.runtime.decision(decisionId))?.status, 'pending');
  assert.equal(value(fixture.services.runtime.decision(decisionId))?.questions[0]?.options.length, 2);
  assert(value(fixture.services.runtime.incident(incidentId)));
  assert(value(fixture.services.repositories.listenerRun.find({ id: run.runId })));
  assert.deepEqual(sqliteMetadata.foreignKeyViolations(fixture.database), []);
});

test('age boundaries and configured retention apply to every retained traffic/token summary while idle', async scope => {
  const fixture = await fixtureStore(scope, 14), agent = await fixture.agent(fixture.admin.actor, 'summaries');
  const run = fixture.listen(agent), createdAt = fixture.now();
  value(fixture.services.statistics.record(agent.id, run.runId, { sequence: 1, startedAt: createdAt, endedAt: createdAt, dropped: 0,
    flows: [{ roomId: '!room:test.localhost', senderBackendUserId: fixture.admin.member.principal.backendUserId, messageType: 'm.text',
      observed: 1, delivered: 1, contentBytes: 40, deliveredBytes: 40, attachmentBytes: 100, largestBytes: 40 }],
    usage: [{ runtime: 'codex', sessionId: 'native-history', tokens: { input: 100, cachedInput: 20, cacheWriteInput: null, output: 10, reasoningOutput: 5, total: 110 } }] }, createdAt));
  fixture.advance(14 * DAY_MS); value(maintainLogging(fixture.services));
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).totals.observed, 1, 'Equality at the cutoff is retained');
  const session = value(await createSession(fixture.services, fixture.admin.token));
  const refreshed = value(await authenticateMember(fixture.services, session.secret));
  const measured = value(readFleetStatistics(fixture.services, refreshed.actor, agent.controller.fleetId, { hours: 720, page: 1, pageSize: 20 }));
  assert.equal(measured.retentionDays, 14); assert.equal(measured.since, createdAt);
  fixture.advance(1); value(maintainLogging(fixture.services));
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).totals.observed, 0);
  assert.equal(executeSelect(fixture.database, schema, query => query.from('listener_stat_flow').count()), 0);
  assert.equal(executeSelect(fixture.database, schema, query => query.from('listener_stat_usage').count()), 0);
  assert.equal(executeSelect(fixture.database, schema, query => query.from('listener_stat_checkpoint').count()), 0);
  assert.equal(executeSelect(fixture.database, schema, query => query.from('runtime_usage_checkpoint').count()), 0);
});

test('settled decisions, notifications, deliveries, operation receipts, invitations and enrollment history expire without losing authority', async scope => {
  const fixture = await fixtureStore(scope), { services, database, admin } = fixture, agent = await fixture.agent(admin.actor, 'workflow');
  const first = fixture.listen(agent), controller = value(authenticateController(services, agent.controller.credential)), fleetId = agent.controller.fleetId;
  const question = { id: randomUUID(), runId: first.runId, sessionId: 'native-history', runtime: 'codex', requestId: 'question', turnId: 'turn', itemId: 'item',
    kind: 'question' as const, action: 'Decide', review: 'Owner decision', blocking: true, expiresAt: null,
    questions: [{ id: 'continue', title: 'Continue?', prompt: 'Continue?', secret: false, allowText: false, options: [{ id: 'yes', label: 'Yes', description: 'Continue' }] }] };
  value(createDecision(services, agent.actor, agent.id, question));
  value(answerDecision(services, admin.actor, agent.id, question.id, { answers: [{ questionId: 'continue', optionId: 'yes', text: null }] }, randomUUID()));
  assert.equal(value(receiptDecision(services, agent.actor, agent.id, question.id, 'responded')).recorded, true);
  const permission = { ...question, id: randomUUID(), requestId: 'permission', kind: 'permission' as const, questions: [] };
  value(createDecision(services, agent.actor, agent.id, permission)); value(receiptDecision(services, agent.actor, agent.id, permission.id, 'cancelled'));
  const messageId = randomUUID(); value(createFleetMessage(services, admin.actor, fleetId, { messageId, body: 'Useful input, not an audit body' }, randomUUID()));
  value(acknowledgeFleetMessage(services, controller, fleetId, messageId, agent.id, { status: 'delivered', errorMessage: null }));
  const revision = value(services.repositories.fleet.findById(fleetId))!.revision, operationId = randomUUID();
  value(requestFleetRuntime(services, admin.actor, fleetId, { operationId, agentId: agent.id, action: 'start', expectedRevision: revision, confirmFreshHistory: false }, randomUUID()));
  value(claimFleetRuntime(services, controller, fleetId, operationId, agent.controller.connectionId));
  value(receiptFleetRuntime(services, controller, fleetId, operationId, { connectionId: agent.controller.connectionId, status: 'succeeded', errorMessage: null }));
  const invitation = value(createMemberInvitation(services, admin.actor, { roleCode: 'member', expiresSeconds: 60 }, randomUUID()));
  const claimed = value(createMemberInvitation(services, admin.actor, { roleCode: 'member', expiresSeconds: 60 }, randomUUID()));
  executeUpdate(database, schema, (query, params) => query.update('member_invitation').set({ claim_backend_user_id: '@pending:test.localhost',
    claim_display_name: 'Pending user', claim_fingerprint: 'unsettled-claim' }).where(row => row.id === params.id), { id: claimed.invitationId });
  const incident = randomUUID(); value(services.runtime.insertIncident({ id: incident, ownerId: admin.actor.principalId, agentId: agent.id, fleetId: null, runId: first.runId,
    sessionId: 'native-history', kind: 'contact', message: 'Recovered contact', createdAt: fixture.now(), recoveredAt: fixture.now() }));
  for (const phase of ['initial', 'recovery'] as const) value(services.runtime.insertNotification({ incidentId: incident, phase, body: 'Owner notification', nextAttemptAt: fixture.now(), eventId: '$sent-' + phase }));
  for (const status of ['pending', 'sent', 'denied'] as const) executeInsert(database, schema, (query, params) => query.insertInto('wake_notice').values({ receiver_agent_id: params.agentId,
    event_id: params.eventId, sender_backend_user_id: params.sender, room_id: params.roomId, reserved_at: params.at, message_body: 'Wake notice', status: params.status,
    sent_at: params.sent, native_event_id: params.nativeEvent, next_attempt_at: params.next, last_error: null }),
  { agentId: agent.id, eventId: '$wake-' + (status === 'denied' ? 'pending' : status), roomId: status === 'denied' ? '!other:test.localhost' : '!room:test.localhost', sender: admin.member.principal.backendUserId, at: fixture.now(), status,
    sent: status === 'sent' ? fixture.now() : null, nativeEvent: status === 'sent' ? '$sent' : null, next: status === 'pending' ? fixture.now() : null });
  const ruleId = randomUUID(); value(createWakeRule(services, admin.actor, ruleId, { name: 'Scheduled task', message: 'Do the task', schedule: { kind: 'interval', seconds: 60 }, enabled: true, agentIds: [agent.id] }, randomUUID()));
  fixture.advanceConnected(60001, agent.controller); fixture.listen(agent, 'test', first.runId);
  const wake = value(claimWake(services, agent.actor, agent.id, first))!; assert(wake);
  value(acknowledgeWake(services, agent.actor, agent.id, wake.deliveryId, first));
  value(reportListener(services, agent.actor, agent.id, first.runId, { statistics: null, release: 'test', messagesDelivered: 1, stopped: true, controller: agent.controller }, 'stop'));
  const oldStop = randomUUID(); value(recordNativeStop(services, controller, fleetId, agent.id, { connectionId: agent.controller.connectionId, runId: first.runId, receiptId: oldStop }));
  fixture.advance(1); const second = fixture.listen(agent);
  value(reportListener(services, agent.actor, agent.id, second.runId, { statistics: null, release: 'test', messagesDelivered: 1, stopped: true, controller: agent.controller }, 'stop'));
  const currentStop = randomUUID(); value(recordNativeStop(services, controller, fleetId, agent.id, { connectionId: agent.controller.connectionId, runId: second.runId, receiptId: currentStop }));
  const introduction = { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: admin.member.principal.backendUserId,
    fleetKey: 'rejected', controller: { name: 'Rejected controller' }, instances: [{ instanceKey: 'rejected', name: 'rejected', coordinationPolicy: defaultCoordinationPolicy(admin.member.principal.backendUserId) }] };
  const proposed = value(await introduceEnrollment(services, introduction));
  value(decideEnrollment(services, admin.actor, introduction.enrollmentId, { expectedRevision: 0, decision: 'reject', verificationCode: proposed.request.verificationCode }, randomUUID()));
  const source = executeSelect(database, schema, query => query.from('enrollment_request').where(row => row.status === 'approved').take(1))[0]!, archive = randomUUID();
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive').values({ controller_name: params.controller_name, controller_credential_hash: params.controller_credential_hash,
    fleet_key: params.fleet_key, id: params.id, owner_id: params.owner_id, verification_code: params.verification_code, claim_hash: params.claim_hash, roster_digest: params.roster_digest,
    status: params.status, revision: params.revision, created_at: params.created_at, expires_at: params.expires_at, decided_by_member_id: params.decided_by_member_id, decided_at: params.decided_at }), { ...source, id: archive });
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_item').values({ request_id: params.archive, instance_key: 'workflow', requested_name: 'workflow',
    outcome: 'existing', agent_id: params.agent, failure_code: null }), { archive, agent: agent.id });
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_policy').values({ request_id: params.archive, instance_key: 'workflow', wake_mode: 'selected', expected_agent_revision: null }), { archive });
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_permission').values({ request_id: params.archive, instance_key: 'workflow', permission_code: 'room.agent.invite', grant_scope: 'agent_room' }), { archive });
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_wake_sender').values({ request_id: params.archive, instance_key: 'workflow', sender_principal_id: params.owner, include_agents: 0 }), { archive, owner: admin.actor.principalId });
  executeInsert(database, schema, (query, params) => query.insertInto('enrollment_archive_metadata').values({ enrollment_id: params.archive, key: 'label', value: 'Archived diagnostic metadata' }), { archive });
  const backup = fixture.file + '.backup'; await database.backup(backup); chmodSync(backup, 0o600); const backupBytes = readFileSync(backup);
  fixture.advance(8 * DAY_MS); value(maintainLogging(services));
  assert.equal(value(services.runtime.decision(question.id)), null); assert.equal(value(services.runtime.decision(permission.id)), null);
  assert.equal(executeSelect(database, schema, query => query.from('runtime_decision_question').count()), 0);
  assert.equal(executeSelect(database, schema, query => query.from('runtime_decision_option').count()), 0);
  assert.equal(executeSelect(database, schema, query => query.from('runtime_decision_answer').count()), 0);
  assert.equal(value(services.runtime.incident(incident)), null); assert.equal(executeSelect(database, schema, query => query.from('incident_notification').count()), 0);
  assert.equal(value(services.repositories.fleetRuntimeOperation.find(operationId)), null);
  assert.equal(value(services.repositories.fleetMessage.find(messageId)), null); assert.equal(executeSelect(database, schema, query => query.from('fleet_message_delivery').count()), 0);
  assert.equal(value(services.repositories.memberInvitation.find({ id: invitation.invitationId })), null);
  assert(value(services.repositories.memberInvitation.find({ id: claimed.invitationId })), 'Unsettled native signup cleanup is retained');
  assert.deepEqual(executeSelect(database, schema, query => query.from('wake_notice').select(row => ({ status: row.status }))), [{ status: 'pending' }]);
  assert.equal(executeSelect(database, schema, query => query.from('wake_delivery').count()), 0);
  assert.equal(executeSelect(database, schema, query => query.from('enrollment_archive').count()), 0);
  assert.equal(value(services.repositories.enrollmentRequest.find({ id: introduction.enrollmentId })), null);
  assert(value(services.repositories.enrollmentRequest.find({ id: source.id })), 'Approved exchange identity is not logging');
  assert.equal(value(services.repositories.nativeStop.receipt(agent.id, oldStop)), null);
  assert.equal(value(services.repositories.nativeStop.find(agent.id))?.receiptId, currentStop);
  assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  assert.equal((await verifyPreservation(backup, fixture.file)).ok, false, 'Strict preservation cannot excuse deleted history without explicit retention evidence');
  const proof = value((await verifyPreservation(backup, fixture.file, { loggingRetentionDays: 7, at: fixture.now() })));
  assert.equal(proof.expired.enrollment_archive, 1); assert.equal(proof.expired.fleet_native_stop, 1); assert.equal(proof.preserved.fleet_native_stop, 1);
  assert.deepEqual(readFileSync(backup), backupBytes);
  fixture.renewController(agent.controller);
  assert.equal(value(receiptDecision(services, agent.actor, agent.id, question.id, 'responded')).recorded, false);
  assert.equal(value(acknowledgeWake(services, agent.actor, agent.id, wake.deliveryId, first)).recorded, false);
  assert.equal(value(receiptFleetRuntime(services, controller, fleetId, operationId, { connectionId: agent.controller.connectionId, status: 'succeeded', errorMessage: null })).recorded, false);
  assert.equal(value(acknowledgeFleetMessage(services, controller, fleetId, messageId, agent.id, { status: 'delivered', errorMessage: null })).recorded, false);
  assert.equal(receiptDecision(services, admin.actor, agent.id, question.id, 'responded').ok, false);
  assert.equal(acknowledgeFleetMessage(services, admin.actor, fleetId, messageId, agent.id, { status: 'delivered', errorMessage: null }).ok, false);
  assert.equal(claimFleetRuntime(services, controller, fleetId, operationId, agent.controller.connectionId).ok, false, 'Expired history never becomes a fresh execution request');
  executeUpdate(database, schema, (query, params) => query.update('fleet_native_stop').set({ invalidated_at: params.at }).where(row => row.receipt_id === params.id), { id: currentStop, at: fixture.now() });
  assert.equal((await verifyPreservation(backup, fixture.file, { loggingRetentionDays: 7, at: fixture.now() })).ok, false, 'Retention never excuses changing a surviving old record');
});

test('reconnect-heavy history is cleaned in bounded batches and expected cleanup failures roll back the whole batch', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'batches'), createdAt = fixture.now();
  const first = fixture.listen(agent), base = value(fixture.services.repositories.listenerRun.find({ id: first.runId }))!;
  for (let position = 0; position < 25; position++) value(fixture.services.repositories.listenerRun.insert({ ...base, id: randomUUID() }));
  fixture.advance(8 * DAY_MS); fixture.renewController(agent.controller); fixture.listen(agent);
  const firstBatch = value(maintainLogging(fixture.services, 5)); assert.equal(firstBatch.more, true);
  assert.equal(executeSelect(fixture.database, schema, (query, params) => query.from('listener_run').where(row => row.started_at === params.at).count(), { at: createdAt }), 21);
  let more = true, rounds = 0;
  while (more && rounds++ < 20) more = value(maintainLogging(fixture.services, 5)).more;
  assert.equal(more, false); assert.equal(executeSelect(fixture.database, schema, query => query.from('listener_run').count()), 1);
  const earlier = value(fixture.services.repositories.listenerRun.find({ id: value(fixture.services.listenerRead.history(agent.id, { page: 1, pageSize: 1 })).items[0]!.id }))!;
  const old = { ...earlier, id: randomUUID(), startedAt: createdAt, lastSeenAt: createdAt };
  value(fixture.services.repositories.listenerRun.insert(old));
  value(fixture.services.runtime.saveObservation(agent.id, { runId: old.id, sessionId: 'rollback-history', roomId: null, runtime: 'codex', state: 'idle', observedAt: createdAt,
    historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, lastActivityAt: createdAt, historyAvailable: true, settings: [] }));
  fixture.database.exec("CREATE TRIGGER reject_retention BEFORE DELETE ON runtime_observation BEGIN SELECT RAISE(ABORT, 'expected cleanup failure'); END");
  const result = maintainLogging(fixture.services); assert.equal(result.ok, false);
  assert(value(fixture.services.repositories.listenerRun.find({ id: old.id })), 'An expected transaction failure cannot partially remove the parent');
  assert.equal(executeSelect(fixture.database, schema, query => query.from('runtime_observation').where(row => row.session_id === 'rollback-history').count()), 1);
  assert.deepEqual(sqliteMetadata.foreignKeyViolations(fixture.database), []);
});

test('current whole-fleet and individual stop evidence survives history expiry without starving older completed operations', async scope => {
  const fixture = await fixtureStore(scope), { services, admin, database } = fixture, agent = await fixture.agent(admin.actor, 'stopped');
  const run = fixture.listen(agent), fleetId = agent.controller.fleetId, controller = value(authenticateController(services, agent.controller.credential));
  value(services.runtime.saveObservation(agent.id, { ...run, sessionId: 'retained-history', roomId: null, runtime: 'codex', state: 'working', observedAt: fixture.now(),
    historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, lastActivityAt: fixture.now(), historyAvailable: true, settings: [] }));
  value(reportListener(services, agent.actor, agent.id, run.runId, { statistics: null, release: 'test', messagesDelivered: 0, stopped: true, controller: agent.controller }, 'stop'));
  const current: string[] = [];
  for (const agentId of [null, agent.id]) for (let index = 0; index < 3; index++) {
    fixture.advance(1);
    const operationId = randomUUID(), revision = value(services.repositories.fleet.findById(fleetId))!.revision;
    value(requestFleetRuntime(services, admin.actor, fleetId, { operationId, agentId, action: 'stop', expectedRevision: revision, confirmFreshHistory: false }, randomUUID()));
    value(claimFleetRuntime(services, controller, fleetId, operationId, agent.controller.connectionId));
    value(receiptFleetRuntime(services, controller, fleetId, operationId, { connectionId: agent.controller.connectionId, status: 'succeeded', errorMessage: null }));
    if (index === 2) current.push(operationId);
  }
  fixture.advance(8 * DAY_MS);
  let more = true, rounds = 0; while (more && rounds++ < 20) more = value(maintainLogging(services, 1)).more;
  assert.equal(more, false);
  assert.deepEqual(executeSelect(database, schema, query => query.from('fleet_runtime_operation').select(row => ({ id: row.id }))).map(row => row.id).sort(), current.sort());
  assert.equal(value(services.runtime.summaries([agent.id])).get(agent.id)?.state, 'stopped');
  assert.equal(value(services.repositories.nativeStop.find(agent.id)), null, 'Lifecycle history cannot fabricate native retirement proof');
});
