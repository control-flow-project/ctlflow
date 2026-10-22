import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { contractError, contractHttp, type ContractReply } from '@ctlflow/crossfire-test-support/contract-http';
import { integer, list, observe, record, text } from '@ctlflow/crossfire-test-support/contract-process';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContractStack } from './fixture.js';
import { publicationBrowser } from './browser.contract.js';
import { paginationContracts } from '@ctlflow/crossfire-test-support/contract-pagination';
import { resourceContracts } from './resources.contract.js';
import { defineSelect } from '@tinqerjs/tinqer';
import { executeSelect, toSql } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { metadataSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

export async function managementDocumentContracts(request: (path: string, method: string) => Promise<ContractReply>): Promise<void> {
  for (const path of ['/manage', '/manage/', '/manage/fleets']) for (const method of ['GET', 'HEAD']) {
    const response = await request(path, method), label = method + ' ' + path;
    assert.equal(response.status, 200, label);
    assert.equal(response.headers['referrer-policy'], 'no-referrer', label + ' retains one private referrer policy');
    assert.equal(response.headers['x-frame-options'], 'DENY', label + ' rejects embedding');
  }
}

export async function serverContracts(scope: TestContext, fixture: ContractStack): Promise<void> {
  await scope.test('management documents retain private referrer and framing headers', () => managementDocumentContracts(fixture.raw));
  await paginationContracts(scope, query => fixture.raw('/api/fleets' + query, 'GET', undefined, fixture.headers()));
  await scope.test('every protected canonical route authenticates before exposing resources', async () => {
    for (const [name, operation] of Object.entries(operations)) {
      if (operation.auth === 'public') continue;
      const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(key === 'roomId' ? '!contract:architecture.localhost' : key === 'eventId' ? '$contract' : randomUUID()));
      const response = await fixture.raw(path, operation.method, operation.method === 'GET' ? undefined : {}, { Origin: fixture.origin, 'X-Crossfire-CSRF': 'not-an-authenticated-session' }); assert.equal(response.status, 401, name + ': ' + JSON.stringify(response.body).slice(0, 1024));
    }
  });
  await scope.test('strict HTTP, cookies, CSRF and unchanged shared management assets', async () => {
    await fixture.operation(operations.health); await fixture.operation(operations.release); await fixture.operation(operations.currentSession);
    const backend = await fixture.operation(operations.messagingBackend);
    assert.equal(record(backend.data).type, 'matrix');
    await fixture.failure(await fixture.raw('/api/health?unknown=1'), 400, 'invalid'); await fixture.failure(await fixture.raw('/api/health', 'GET', undefined, { Origin: 'https://foreign.invalid' }), 403, 'forbidden');
    await fixture.failure(await fixture.raw('/api/member-invitations', 'POST', { roleCode: 'member', expiresSeconds: 600 }, { Cookie: fixture.owner.cookie, Origin: fixture.origin }), 403, 'forbidden');
    await fixture.failure(await fixture.raw('/api/agents?page=1&page=2', 'GET', undefined, fixture.headers()), 400, 'invalid'); await fixture.failure(await fixture.raw('/api/agents?after=removed', 'GET', undefined, fixture.headers()), 400, 'invalid');
    assert.equal((await fixture.raw('/_coord/health')).status, 404); assert.equal((await fixture.raw('/manage/fleets')).status, 200);
    for (const path of ['/config.json', '/config.' + new URL(fixture.origin).hostname + '.json']) {
      const configuration = await fixture.raw(path); assert.equal(configuration.status, 200); assert.equal(record(configuration.body).brand, 'crossfire');
    }
    for (const path of ['/config.json/../bootstrap.json', '/manage/assets/%2e%2e%2fpackage.json', '/_coord/install.mjs']) assert.equal((await fixture.raw(path)).status, 404, 'Unsafe or removed public asset: ' + path);
    const descriptor = await fixture.raw('/onboarding/setup.json?ownerBackendUserId=' + encodeURIComponent(fixture.owner.backendUserId), 'GET', undefined, fixture.headers()); assert.equal(descriptor.status, 200); assert.equal(record(descriptor.body).ownerBackendUserId, fixture.owner.backendUserId);
    const guide = await fixture.raw('/onboarding/setup?ownerBackendUserId=' + encodeURIComponent(fixture.owner.backendUserId));
    assert.equal(guide.status, 200);
    const instructions = text(guide.body);
    for (const required of ['Docker hosts the server only.', 'The selected Codex/Pi installation and native login must already exist there.',
      'Never install or upgrade Codex/Pi as part of these instructions.', 'Earendil Pi requires explicit ordinary fleet configuration.',
      'Do not attach this coding session; fleetd starts a separate managed native session.']) assert(instructions.includes(required), required);
    assert(!instructions.includes('command -v codex'), 'The installer must not reject an explicitly configured Pi-only host');
  });
  await scope.test('malformed UTF-8 is rejected without changing identity text or revision', async () => {
    const before = await fixture.data(operations.member, { memberId: fixture.owner.memberId });
    for (const invalid of [[255], [192, 175], [237, 160, 128], [244, 144, 128, 128], [226, 130]]) {
      const bytes = Buffer.concat([Buffer.from('{"expectedRevision":' + integer(before.revision) + ',"displayName":"unchanged-'), Buffer.from(invalid), Buffer.from('"}')]);
      await fixture.failure(await fixture.raw('/api/members/' + fixture.owner.memberId, 'PATCH', bytes, { ...fixture.headers(), 'Content-Type': 'application/json' }), 400, 'invalid');
    }
    for (const invalid of ['\ud800', '\udfff', 'before\ud800after', '\ud800🚀']) {
      await fixture.failure(await fixture.raw('/api/members/' + fixture.owner.memberId, 'PATCH', { expectedRevision: integer(before.revision), displayName: invalid }, fixture.headers()), 400, 'invalid');
      const bytes = Buffer.from('{"expectedRevision":' + integer(before.revision) + ',"displayName":"unchanged","\\ud800":true}');
      await fixture.failure(await fixture.raw('/api/members/' + fixture.owner.memberId, 'PATCH', bytes, { ...fixture.headers(), 'Content-Type': 'application/json' }), 400, 'invalid');
    }
    const after = await fixture.data(operations.member, { memberId: fixture.owner.memberId });
    assert.equal(after.displayName, before.displayName); assert.equal(after.revision, before.revision, 'Malformed UTF-8 cannot silently change identity text');
  });
  await scope.test('invitation registration is explicit and works without an Origin on its GET review', async () => {
    const outsider = await fixture.member('contract-outsider'); const page = await fixture.operation(operations.agents, {}, undefined, outsider); assert.equal(list(page.data).length, 0);
    const response = await fixture.raw('/_matrix/client/v3/user_directory/search', 'POST', { search_term: '', limit: 1 }, { Authorization: 'Bearer ' + outsider.nativeToken }); assert.equal(response.status, 200); assert.equal(list(record(response.body).results).length, 1);
    const policy = await fixture.data(operations.policy, {}, undefined, outsider); const { revision, ...values } = policy;
    const denied = await fixture.raw('/api/instance-policy', 'PATCH', { expectedRevision: revision, ...values }, fixture.headers(outsider)); assert.equal(denied.status, 403);
  });
  const agent = await fixture.agent(); const params = { agentId: agent.id }, fleetParams = { fleetId: agent.fleetId };
  const controller = { fleetId: agent.fleetId, connectionId: agent.connectionId, credential: agent.credential }, runId = randomUUID();
  await scope.test('enrollment identities, collisions, owner directory and scoped grants', async () => {
    assert.equal((await fixture.data(operations.agent, params)).name, agent.name); await fixture.operation(operations.fleetAgents, fleetParams, undefined, agent.credential); await fixture.operation(operations.deliveryPolicy, params, undefined, agent.token);
    const conflict = await fixture.raw('/api/enrollments/preflight', 'POST', { ownerBackendUserId: fixture.owner.backendUserId, fleetKey: 'collision-check', controller: { name: 'Other controller' }, instances: [{ instanceKey: 'different', name: agent.name, coordinationPolicy: { wakeMode: 'selected', senders: [{ backendUserId: fixture.owner.backendUserId, includeAgents: false }], permissions: [] } }] }); contractError(conflict, 409, 'name_collision');
    const room = await contractHttp(fixture.native.base, 'POST', '/_matrix/client/v3/createRoom', { name: 'Shared contract room', invite: [agent.backendUserId] }, { Authorization: 'Bearer ' + fixture.owner.nativeToken }); assert.equal(room.status, 200); const roomId = text(record(room.body).room_id);
    await fixture.operation(operations.acceptRoomInvitation, params, { roomId }, agent.token); const grant = await fixture.data(operations.grant, { ...params, roomId }); assert.equal(record(grant.grant).roomId, roomId);
    const conversation = await fixture.data(operations.ownerConversation, params, {}, agent.token); const ownerRoom = text(conversation.roomId); assert.notEqual(ownerRoom, roomId);
    const membership = await contractHttp(fixture.native.base, 'GET', '/_matrix/client/v3/rooms/' + encodeURIComponent(ownerRoom) + '/joined_members', undefined, { Authorization: 'Bearer ' + agent.token }); assert.equal(membership.status, 200); assert.deepEqual(Object.keys(record(record(membership.body).joined)).sort(), [fixture.owner.backendUserId, agent.backendUserId].sort());
    await fixture.operation(operations.grants, params); await fixture.operation(operations.wakePolicy, params); await fixture.operation(operations.resolvePrincipals, {}, { backendUserIds: [agent.backendUserId, fixture.owner.backendUserId] }, agent.token);
  });
  await scope.test('controller leases, message receipts, runtime status and explicit owner answers', async () => {
    await fixture.operation(operations.reportFleetConnection, { ...fleetParams, connectionId: agent.connectionId }, { stopped: false }, agent.credential);
    const sessionId = randomUUID(); await fixture.operation(operations.reportListener, { ...params, runId }, { release: fixture.release.release.manifest.release, messagesDelivered: 0, stopped: false, statistics: null, controller }, agent.token);
    await fixture.operation(operations.reportRuntime, { ...params, runId }, { sessionId, roomId: null, runtime: 'codex', state: 'idle', observedAt: Date.now(), lastActivityAt: Date.now(), historyAvailable: true, historyMode: 'shared', maxInputBytes: 65536, settings: [{ name: 'model', configured: 'fixture', effective: 'fixture' }], errorMessage: null }, agent.token);
    assert.equal(list((await fixture.operation(operations.runtimeObservations, params)).data).length, 1);
    const id = randomUUID(); await fixture.operation(operations.createRuntimeDecision, params, { id, runId, runtime: 'codex', sessionId, requestId: 'request-1', turnId: 'turn-1', itemId: 'item-1', kind: 'question', action: 'question', review: 'Choose explicitly', blocking: true, expiresAt: null, questions: [{ id: 'choice', title: 'Choose', prompt: 'Yes or no?', secret: false, allowText: false, options: [{ id: 'yes', label: 'Yes', description: 'Proceed' }, { id: 'no', label: 'No', description: 'Stop' }] }] }, agent.token);
    const decisionParams = { ...params, decisionId: id }; assert.equal((await fixture.data(operations.runtimeDecision, decisionParams)).status, 'pending'); assert.equal((await fixture.data(operations.pollRuntimeDecision, decisionParams, undefined, agent.token)).status, 'pending');
    await fixture.operation(operations.answerRuntimeDecision, decisionParams, { answers: [{ questionId: 'choice', optionId: 'no', text: null }] }); assert.equal((await fixture.data(operations.pollRuntimeDecision, decisionParams, undefined, agent.token)).status, 'answered'); await fixture.operation(operations.receiptRuntimeDecision, decisionParams, { status: 'responded' }, agent.token);
    const messageId = randomUUID(); await fixture.operation(operations.createFleetMessage, fleetParams, { messageId, body: 'Shared contract message' }, agent.credential);
    const current = await fixture.data(operations.fleet, fleetParams, undefined, agent.credential); await fixture.operation(operations.fleetControl, fleetParams, undefined, agent.credential, '?connectionId=' + agent.connectionId + '&revision=' + integer(current.revision) + '&waitMs=0'); await fixture.operation(operations.acknowledgeFleetMessage, { ...fleetParams, messageId, agentId: agent.id }, { status: 'delivered', errorMessage: null }, agent.credential);
    const messages = await fixture.operation(operations.fleetMessages, fleetParams, undefined, agent.credential); assert.equal(record(list(messages.data)[0]).delivered, 1);
  });
  await scope.test('an open management read snapshot cannot block a controller heartbeat commit', async () => {
    const reader = new Database(join(fixture.state, 'management.sqlite'), { readonly: true, fileMustExist: true });
    try {
      const journal = executeSelect(reader, metadataSchema, query => query.from('pragma_journal_mode')
        .select(row => ({ mode: row.journal_mode })).firstOrDefault());
      assert.equal(journal?.mode, 'wal');
      const generated = toSql(defineSelect(schema, (query, params: { fleetId: string }) => query.from('fleet_connection')
        .where(row => row.fleet_id === params.fleetId).select(row => ({ last_seen_at: row.last_seen_at }))), { fleetId: agent.fleetId });
      const snapshot = reader.prepare<[Record<string, unknown>], { last_seen_at: number }>(generated.sql).iterate(generated.params);
      try {
        const previous = snapshot.next(); assert(!previous.done);
        const read = () => executeSelect(reader, schema, (query, params) => query.from('fleet_connection')
          .where(row => row.fleet_id === params.fleetId).select(row => ({ last_seen_at: row.last_seen_at })).firstOrDefault(), { fleetId: agent.fleetId });
        await fixture.operation(operations.reportFleetConnection, { ...fleetParams, connectionId: agent.connectionId }, { stopped: false }, agent.credential);
        assert.deepEqual(read(), previous.value, 'The existing reader keeps its snapshot while the controller commits');
        snapshot.return?.();
        const current = read();
        assert(current && current.last_seen_at > previous.value.last_seen_at);
      } finally { snapshot.return?.(); }
    } finally { reader.close(); }
  });
  await scope.test('static publications are separate-origin, immutable, readable by link and owner-deletable', async () => {
    const bytes = Buffer.from('<!doctype html><body>Shared report<script>document.body.dataset.origin=globalThis.origin;try{document.cookie;document.body.dataset.cookie="readable"}catch{document.body.dataset.cookie="blocked"}try{localStorage.length;document.body.dataset.storage="readable"}catch{document.body.dataset.storage="blocked"}document.body.dataset.report="ready";</script></body>'); const publication = await fixture.data(operations.createPublication, {}, { title: 'Shared report', files: [{ path: 'index.html', bytes: bytes.length, mediaType: 'text/html', sha256: createHash('sha256').update(bytes).digest('hex') }] }, agent.token);
    const publicationId = text(publication.id); const file = record(list(publication.files)[0]); await fixture.operation(operations.uploadPublicationFile, { publicationId, fileId: text(file.id) }, bytes, agent.token); const committed = await fixture.data(operations.commitPublication, { publicationId }, { expectedRevision: integer(publication.revision) }, agent.token); const url = new URL(text(committed.url)); assert.equal(url.origin, fixture.contentOrigin);
    await fixture.operation(operations.publications); await fixture.operation(operations.publication, { publicationId });
    const published = await contractHttp(fixture.contentOrigin, 'GET', url.pathname); assert.equal(published.status, 200); assert.equal(published.headers['set-cookie'], undefined); assert.equal(published.headers['access-control-allow-origin'], '*'); assert.equal(published.headers['access-control-allow-credentials'], undefined); assert.match(text(published.headers['content-security-policy']), /sandbox allow-scripts(?:;|$)/u); assert(!text(published.headers['content-security-policy']).includes('allow-same-origin'));
    await publicationBrowser(url.href);
    await fixture.operation(operations.deletePublication, { publicationId }, { expectedRevision: integer(committed.revision) }); assert.equal((await contractHttp(fixture.contentOrigin, 'GET', url.pathname)).status, 404);
    await fixture.operation(operations.reportListener, { ...params, runId }, { release: fixture.release.release.manifest.release, messagesDelivered: 1, stopped: true, statistics: null, controller }, agent.token); await fixture.operation(operations.recordFleetNativeStop, { ...fleetParams, agentId: agent.id }, { connectionId: agent.connectionId, runId, receiptId: randomUUID() }, agent.credential);
    const emptyRun = randomUUID();
    await fixture.operation(operations.reportListener, { ...params, runId: emptyRun }, { release: fixture.release.release.manifest.release, messagesDelivered: 0, stopped: false, statistics: null, controller }, agent.token);
    const emptyObservations = await fixture.operation(operations.runtimeObservations, params);
    assert.deepEqual(emptyObservations.data, [], 'A new listener without observations cannot expose the preceding run');
    await fixture.operation(operations.reportListener, { ...params, runId: emptyRun }, { release: fixture.release.release.manifest.release, messagesDelivered: 0, stopped: true, statistics: null, controller }, agent.token);
    await fixture.operation(operations.recordFleetNativeStop, { ...fleetParams, agentId: agent.id }, { connectionId: agent.connectionId, runId: emptyRun, receiptId: randomUUID() }, agent.credential);
  });
  await scope.test('every backend resumes the exact same SQLite file and canonical identities', async () => {
    const original = fixture.current();
    for (const target of fixture.targets) { await fixture.restart(target); const current = await fixture.data(operations.agent, params); assert.equal(current.agentId, agent.id); assert.equal(current.backendUserId, agent.backendUserId); await fixture.operation(operations.currentSession); }
    await fixture.restart(original);
  });
  await scope.test('wake schedules, revisions and deletion use one canonical API', async () => {
    const ruleId = randomUUID(); const source = { name: 'Shared wake', message: 'Review only if still authorized', schedule: { kind: 'cron', expression: '0 9 * * MON-FRI', timeZone: 'Asia/Kolkata' }, enabled: true, agentIds: [agent.id] };
    const created = await fixture.data(operations.createWakeRule, {}, { ruleId, ...source }); assert.equal(created.ruleId, ruleId); assert(integer(created.nextDueAt) > Date.now()); await fixture.operation(operations.wakeRules);
    const changed = await fixture.data(operations.changeWakeRule, { ruleId }, { expectedRevision: integer(created.revision), ...source, enabled: false }); await fixture.operation(operations.deleteWakeRule, { ruleId }, { expectedRevision: integer(changed.revision) });
    await observe(async () => list((await fixture.operation(operations.wakeRules)).data).length === 0, 'Deleted wake rule must disappear');
  });
  await scope.test('steady-state HTTP and SQLite reads retain correct values without model work', async () => {
    for (let index = 0; index < 10; index++) await fixture.operation(operations.policy);
    const samples: number[] = [];
    for (let index = 0; index < 100; index++) { const started = performance.now(); await fixture.operation(operations.policy); samples.push(performance.now() - started); }
    samples.sort((left, right) => left - right);
    scope.diagnostic(JSON.stringify({ measurement: 'loopback TLS plus authenticated SQLite policy read', target: fixture.current().name, samples: samples.length, p50Ms: samples[49], p95Ms: samples[94] }));
  });
  await resourceContracts(scope, fixture);
  await scope.test('successful shared scenarios cover every declared REST operation', () => fixture.assertOperationCoverage());
}
