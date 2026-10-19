import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { contractHttp, contractError } from '@ctlflow/crossfire-test-support/contract-http';
import { integer, list, observe, record, text } from '@ctlflow/crossfire-test-support/contract-process';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContractStack } from './fixture.js';

export async function resourceContracts(scope: TestContext, fixture: ContractStack): Promise<void> {
  const member = await fixture.member('resource-member'), agent = await fixture.agent('resource-analyst');
  const params = { agentId: agent.id }, fleetParams = { fleetId: agent.fleetId };
  const controller = { fleetId: agent.fleetId, connectionId: agent.connectionId, credential: agent.credential };
  let runId = randomUUID(); const sessionId = randomUUID();
  const report = (stopped: boolean) => fixture.operation(operations.reportListener, { ...params, runId }, { release: fixture.release.release.manifest.release, messagesDelivered: 0, stopped, statistics: null, controller }, agent.token);
  const fleet = () => fixture.data(operations.fleet, fleetParams, undefined, agent.credential);
  await fixture.operation(operations.reportFleetConnection, { ...fleetParams, connectionId: agent.connectionId }, { stopped: false }, agent.credential);
  await report(false);
  const runtime = () => fixture.operation(operations.reportRuntime, { ...params, runId }, { sessionId, roomId: null, runtime: 'codex', state: 'idle', observedAt: Date.now(), lastActivityAt: null,
    historyAvailable: true, historyMode: 'shared', maxInputBytes: 65536, settings: [], errorMessage: null }, agent.token);
  await runtime();
  await scope.test('every operation rejects unknown query fields before resource mutation', async () => {
    for (const [name, operation] of Object.entries(operations)) {
      const values: Record<string, string> = { agentId: agent.id, fleetId: agent.fleetId, runId, memberId: fixture.owner.memberId, enrollmentId: agent.enrollmentId };
      const path = operation.path.replace(/\{([A-Za-z]+)\}/gu, (_match, key: string) => encodeURIComponent(values[key] ?? (key === 'roomId' ? '!contract:architecture.localhost' : key === 'eventId' ? '$contract' : randomUUID())));
      const headers = operation.auth === 'agent' ? { Authorization: 'Bearer ' + agent.token } : operation.auth === 'fleet' ? { Authorization: 'Bearer ' + agent.credential } : fixture.headers();
      const response = await fixture.raw(path + '?__unknown=1', operation.method, operation.method === 'GET' ? undefined : {}, headers);
      assert.equal(response.status, 400, name + ': ' + JSON.stringify(response.body).slice(0, 1024)); contractError(response, 400, 'invalid');
    }
  });
  await scope.test('identity directories, member revisions, role authority and invitation lifecycle', async () => {
    for (const operation of [operations.principals, operations.roles, operations.permissions, operations.members, operations.invitations, operations.enrollments, operations.registrationPolicy]) await fixture.operation(operation);
    const memberParams = { memberId: member.memberId }, original = await fixture.data(operations.member, memberParams);
    const changed = await fixture.data(operations.changeMember, memberParams, { expectedRevision: integer(original.revision), displayName: 'Resource member É' }); assert.equal(changed.displayName, 'Resource member É');
    contractError(await fixture.raw('/api/members/' + member.memberId, 'PATCH', { expectedRevision: integer(original.revision), displayName: 'Stale' }, fixture.headers()), 409, 'conflict');
    const promoted = await fixture.data(operations.memberRole, memberParams, { expectedRevision: integer(changed.revision), roleCode: 'administrator' }); assert.equal(promoted.roleCode, 'administrator');
    await fixture.operation(operations.memberRole, memberParams, { expectedRevision: integer(promoted.revision), roleCode: 'member' });
    const invitation = await fixture.data(operations.createInvitation, {}, { roleCode: 'member', expiresSeconds: 600 }); const invitationId = text(invitation.invitationId);
    await fixture.operation(operations.invitation, { invitationId }); await fixture.operation(operations.revokeInvitation, { invitationId });
    const session = await fixture.data(operations.currentSession, {}, undefined, member); assert.equal(record(session.member).displayName, 'Resource member É');
    await fixture.operation(operations.endSession, {}, {}, member); contractError(await fixture.raw('/api/sessions/current', 'GET', undefined, fixture.headers(member)), 401, 'unauthorized');
    const enrollment = await fixture.data(operations.enrollment, { enrollmentId: agent.enrollmentId }); assert.equal(record(enrollment.enrollment).status, 'approved');
    await fixture.operation(operations.preflight, {}, { ownerBackendUserId: fixture.owner.backendUserId, fleetKey: 'availability-only', controller: { name: 'Availability only' }, instances: [{ instanceKey: 'available-name', name: 'available-name', coordinationPolicy: { wakeMode: 'selected', senders: [], permissions: [] } }] });
    const policy = await fixture.data(operations.policy), { revision, ...values } = policy;
    await fixture.operation(operations.changePolicy, {}, { expectedRevision: integer(revision), ...values }); await fixture.operation(operations.audit);
  });
  await scope.test('same-file directories retain ordering, case rules and empty-page counts across every backend', async () => {
    await report(true);
    await fixture.operation(operations.reportFleetConnection, { ...fleetParams, connectionId: agent.connectionId }, { stopped: true }, agent.credential);
    const later = await fixture.agent('aaa-resource-order');
    const laterFleet = await fixture.data(operations.fleet, { fleetId: later.fleetId });
    await fixture.operation(operations.changeFleet, { fleetId: later.fleetId }, { expectedRevision: integer(laterFleet.revision), label: 'Audit É fleet', controller: { name: 'Shared contracts', metadata: {} } });
    const agents = [await fixture.data(operations.agent, params), await fixture.data(operations.agent, { agentId: later.id })];
    const expectedAgents = agents.sort((first, second) => integer(first.createdAt) - integer(second.createdAt) || text(first.agentId).localeCompare(text(second.agentId))).map(value => text(value.agentId));
    const rules: Record<string, unknown>[] = [];
    for (const name of ['audit-order-a', 'audit-order-z', 'audit-order-É']) rules.push(await fixture.data(operations.createWakeRule, {}, { ruleId: randomUUID(), name,
      message: 'Disabled directory fixture', schedule: { kind: 'interval', seconds: 3600 }, enabled: false, agentIds: [] }));
    const expectedRules = rules.sort((first, second) => integer(second.createdAt) - integer(first.createdAt) || text(first.ruleId).localeCompare(text(second.ruleId))).map(value => text(value.ruleId));
    const original = fixture.current();
    try {
      for (const target of fixture.targets) {
        await fixture.restart(target);
        const runs = list((await fixture.operation(operations.listenerRuns, params)).data).map(record);
        const stoppedRun = runs.find(run => run.runId === runId);
        assert(stoppedRun, target.name + ': stopped listener run survives a backend switch');
        assert.equal(stoppedRun.release, fixture.release.release.manifest.release, target.name);
        assert.equal(record(stoppedRun.controller).fleetId, agent.fleetId, target.name);
        assert.equal(record(stoppedRun.controller).connectionId, controller.connectionId, target.name);
        assert.equal(typeof record(stoppedRun.controller).credentialId, 'string', target.name);
        assert.equal(typeof stoppedRun.stoppedAt, 'number', target.name);
        const directory = await fixture.operation(operations.agents, {}, undefined, fixture.owner, '?search=resource&pageSize=100');
        assert.deepEqual(list(directory.data).map(value => text(record(value).agentId)), expectedAgents, target.name);
        const first = await fixture.operation(operations.agents, {}, undefined, fixture.owner, '?search=resource&pageSize=1');
        assert.equal(text(record(list(first.data)[0]).agentId), expectedAgents[0], target.name);
        const matching = await fixture.operation(operations.agents, {}, undefined, fixture.owner, '?search=RESOURCE_ANALYST');
        assert.deepEqual(list(matching.data).map(value => text(record(value).agentId)), [agent.id], target.name + ': ASCII case and LIKE wildcard');
        const none = await fixture.operation(operations.agents, {}, undefined, fixture.owner, '?search=unmatched-directory-search');
        assert.deepEqual(none.data, [], target.name); assert.equal(none.meta.totalPages, 1, target.name);
        const principals = await fixture.operation(operations.principals, {}, undefined, fixture.owner, '?kind=agent&search=RESOURCE_ANALYST');
        assert.deepEqual(list(principals.data).map(value => text(record(value).principalId)), [agent.id], target.name + ': discovery uses the same SQL search');
        const exactHuman = await fixture.operation(operations.principals, {}, undefined, fixture.owner, '?kind=human&search=%C3%89');
        assert.deepEqual(list(exactHuman.data).map(value => text(record(value).principalId)), [member.memberId], target.name + ': discovery retains non-ASCII case');
        const unmatchedHuman = await fixture.operation(operations.principals, {}, undefined, fixture.owner, '?kind=human&search=%C3%A9');
        assert.deepEqual(unmatchedHuman.data, [], target.name + ': discovery has no host-specific case normalization');
        const fleets = await fixture.operation(operations.fleets, {}, undefined, fixture.owner, '?search=RESOURCE_ANALYST');
        assert.deepEqual(list(fleets.data).map(value => text(record(value).fleetId)), [agent.fleetId], target.name + ': fleet search');
        const exactFleet = await fixture.operation(operations.fleets, {}, undefined, fixture.owner, '?search=%C3%89');
        assert.deepEqual(list(exactFleet.data).map(value => text(record(value).fleetId)), [later.fleetId], target.name + ': fleet retains non-ASCII case');
        const unmatchedFleet = await fixture.operation(operations.fleets, {}, undefined, fixture.owner, '?search=%C3%A9');
        assert.deepEqual(unmatchedFleet.data, [], target.name + ': fleet has no host-specific case normalization');
        const reports = await fixture.operation(operations.publications, {}, undefined, fixture.owner, '?search=SHARED_REP_RT');
        assert.deepEqual(list(reports.data).map(value => text(record(value).title)), ['Shared report'], target.name + ': report search');
        const waking = await fixture.operation(operations.wakeRules, {}, undefined, fixture.owner, '?search=audit-order');
        assert.deepEqual(list(waking.data).map(value => text(record(value).ruleId)), expectedRules, target.name);
        const matchingRules = await fixture.operation(operations.wakeRules, {}, undefined, fixture.owner, '?search=AUDIT%25ORDER');
        assert.deepEqual(list(matchingRules.data).map(value => text(record(value).ruleId)), expectedRules, target.name + ': wake search');
        const exactUnicode = await fixture.operation(operations.wakeRules, {}, undefined, fixture.owner, '?search=audit-order-%C3%89');
        assert.equal(list(exactUnicode.data).length, 1, target.name + ': exact non-ASCII scalar');
        const missing = await fixture.operation(operations.wakeRules, {}, undefined, fixture.owner, '?search=audit-order-%C3%A9');
        assert.deepEqual(missing.data, [], target.name); assert.equal(missing.meta.totalPages, 1, target.name);
      }
    } finally { await fixture.restart(original); }
    for (const rule of rules) await fixture.operation(operations.deleteWakeRule, { ruleId: text(rule.ruleId) }, { expectedRevision: integer(rule.revision) });
    agent.connectionId = randomUUID(); controller.connectionId = agent.connectionId; runId = randomUUID();
    await fixture.operation(operations.reportFleetConnection, { ...fleetParams, connectionId: agent.connectionId }, { stopped: false }, agent.credential);
    await report(false);
    await runtime();
  });
  const nativeHeaders = { Authorization: 'Bearer ' + fixture.owner.nativeToken };
  const created = await contractHttp(fixture.native.base, 'POST', '/_matrix/client/v3/createRoom', { name: 'Resource contracts' }, nativeHeaders); assert.equal(created.status, 200); const roomId = text(record(created.body).room_id), roomParams = { ...params, roomId };
  await scope.test('room plans, desired access, native application, delegation and provenance-only removal', async () => {
    await fixture.operation(operations.rooms); await fixture.operation(operations.room, { roomId });
    const plan = { fleetId: agent.fleetId, agents: [{ instanceKey: agent.name, grants: [{ roomId, accessMode: 'reply', nativeAccess: null, muted: false }] }] };
    const preview = await fixture.data(operations.previewGrants, {}, { plan }); assert.equal(list(preview.changes).length, 1);
    await fixture.operation(operations.applyGrants, {}, { plan, digest: preview.digest, snapshots: preview.snapshots });
    await observe(async () => { const view = await fixture.data(operations.grant, roomParams); return view.application !== null && record(view.application).membership === 'join'; }, 'Room plan must actually join the native room');
    let view = await fixture.data(operations.grant, roomParams), grant = record(view.grant);
    view = await fixture.data(operations.setGrantPermissions, roomParams, { expectedRevision: integer(view.revision), expectedGeneration: text(grant.generation), permissions: ['room.agent.invite'] });
    assert.deepEqual((await fixture.data(operations.grantPermissions, roomParams)).permissions, ['room.agent.invite']);
    const helper = await fixture.agent('resource-helper'), helperParams = { agentId: helper.id, roomId };
    const helperView = await fixture.data(operations.agent, { agentId: helper.id });
    const invitation = await fixture.data(operations.setGrant, helperParams, { expectedRevision: integer(helperView.revision), expectedGeneration: null, accessMode: 'reply', nativeAccess: null, muted: false }, agent.token);
    assert.equal(record(invitation.grant).addedById, agent.id);
    await fixture.operation(operations.removeGrant, helperParams, { expectedRevision: integer(invitation.revision), expectedGeneration: text(record(invitation.grant).generation) }, agent.token);
    view = await fixture.data(operations.grant, roomParams); grant = record(view.grant);
    const adjusted = await fixture.data(operations.setGrant, roomParams, { expectedRevision: integer(view.revision), expectedGeneration: text(grant.generation), accessMode: 'reply', nativeAccess: null, muted: true }); assert.equal(record(adjusted.grant).muted, true);
    await fixture.operation(operations.setGrant, roomParams, { expectedRevision: integer(adjusted.revision), expectedGeneration: text(record(adjusted.grant).generation), accessMode: 'reply', nativeAccess: null, muted: false });
    const policy = await fixture.data(operations.wakePolicy, params); await fixture.operation(operations.changeWakePolicy, params, { expectedRevision: integer(policy.revision), mode: 'selected', senders: [] });
    const sent = await contractHttp(fixture.native.base, 'PUT', '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Explicitly addressed', 'm.mentions': { user_ids: [agent.backendUserId] } }, nativeHeaders); assert.equal(sent.status, 200);
    await fixture.operation(operations.wakeNotice, { ...params, eventId: text(record(sent.body).event_id) }, { roomId }, agent.token);
    await fixture.operation(operations.listenerRuns, params);
  });
  await scope.test('scheduled claims validate exact session and acknowledge only their recorded delivery', async () => {
    const ruleId = randomUUID(); await fixture.operation(operations.createWakeRule, {}, { ruleId, name: 'Due claim', message: 'One scheduled input', schedule: { kind: 'interval', seconds: 1 }, enabled: true, agentIds: [agent.id] });
    await fixture.operation(operations.wakeRule, { ruleId });
    await fixture.operation(operations.wakeMetadata, params, undefined, agent.token, '?runId=' + runId + '&sessionId=' + sessionId);
    let delivery: Record<string, unknown> | undefined;
    await observe(async () => { const data = (await fixture.operation(operations.claimWake, params, { runId, sessionId }, agent.token)).data; if (data === null) return false; delivery = record(data); return true; }, 'An interval claim becomes due');
    const deliveryParams = { ...params, deliveryId: text(delivery!.deliveryId) };
    assert.equal((await fixture.data(operations.validateWake, deliveryParams, undefined, agent.token, '?runId=' + runId + '&sessionId=' + sessionId)).eligible, true);
    await fixture.operation(operations.acknowledgeWake, deliveryParams, { runId, sessionId }, agent.token);
    const rule = await fixture.data(operations.wakeRule, { ruleId }); await fixture.operation(operations.deleteWakeRule, { ruleId }, { expectedRevision: integer(rule.revision) });
  });
  await scope.test('owner-invited agents can add and remove collaborators only with delegated and native room authority', async () => {
    const coordinator = await fixture.agent('invitation-coordinator'), partner = await fixture.member('invitation-partner');
    const invited = await contractHttp(fixture.native.base, 'POST', '/_matrix/client/v3/createRoom',
      { name: 'Invitation authority', preset: 'private_chat', invite: [coordinator.backendUserId], power_level_content_override: { invite: 0 } }, nativeHeaders);
    assert.equal(invited.status, 200);
    const collaborationRoom = text(record(invited.body).room_id), coordinatorRoom = { agentId: coordinator.id, roomId: collaborationRoom };
    const grantPath = (agentId: string) => operations.grant.path.replace('{agentId}', agentId).replace('{roomId}', encodeURIComponent(collaborationRoom));
    await fixture.operation(operations.acceptRoomInvitation, { agentId: coordinator.id }, { roomId: collaborationRoom }, coordinator.token);
    const permissions = await fixture.data(operations.grantPermissions, coordinatorRoom);
    assert.deepEqual(permissions.permissions, ['room.agent.invite'], 'Approved fleet delegation applies to human-invited rooms');
    const wake = await fixture.data(operations.wakePolicy, { agentId: coordinator.id });
    await fixture.operation(operations.changeWakePolicy, { agentId: coordinator.id }, { expectedRevision: integer(wake.revision), mode: 'selected', senders: [] });
    for (const [label, owner] of [['same', fixture.owner], ['cross', partner]] as const) {
      const helper = await fixture.agent('invitation-' + label + '-helper', owner), target = { agentId: helper.id, roomId: collaborationRoom };
      let view = await fixture.data(operations.grant, target, undefined, coordinator.token);
      assert.deepEqual(view.allowedActions, ['set'], 'Chat wake policy does not replace room authority');
      view = await fixture.data(operations.setGrant, target,
        { expectedRevision: integer(view.revision), expectedGeneration: null, accessMode: 'reply', nativeAccess: null, muted: false }, coordinator.token);
      assert.equal(record(view.grant).addedById, coordinator.id);
      await observe(async () => {
        const current = await fixture.data(operations.grant, target, undefined, coordinator.token);
        return current.application !== null && record(current.application).membership === 'join';
      }, 'An authorized collaborator actually joins its native room');
      const nativePath = '/_matrix/client/v3/rooms/' + encodeURIComponent(collaborationRoom) + '/state/m.room.power_levels';
      const powers = await contractHttp(fixture.native.base, 'GET', nativePath, undefined, nativeHeaders);
      assert.equal(powers.status, 200);
      assert.equal((await contractHttp(fixture.native.base, 'PUT', nativePath, { ...record(powers.body), invite: 50 }, nativeHeaders)).status, 200);
      contractError(await fixture.raw(grantPath(helper.id), 'GET', undefined,
        { Authorization: 'Bearer ' + coordinator.token }), 404, 'missing');
      assert.equal((await contractHttp(fixture.native.base, 'PUT', nativePath, { ...record(powers.body), invite: 0 }, nativeHeaders)).status, 200);
      let delegation = await fixture.data(operations.grant, coordinatorRoom);
      delegation = await fixture.data(operations.setGrantPermissions, coordinatorRoom,
        { expectedRevision: integer(delegation.revision), expectedGeneration: text(record(delegation.grant).generation), permissions: [] });
      contractError(await fixture.raw(grantPath(helper.id), 'GET', undefined,
        { Authorization: 'Bearer ' + coordinator.token }), 404, 'missing');
      await fixture.operation(operations.setGrantPermissions, coordinatorRoom,
        { expectedRevision: integer(delegation.revision), expectedGeneration: text(record(delegation.grant).generation), permissions: ['room.agent.invite'] });
      view = await fixture.data(operations.grant, target, undefined, coordinator.token);
      assert.deepEqual(view.allowedActions, ['set', 'remove']);
      await fixture.operation(operations.removeGrant, target,
        { expectedRevision: integer(view.revision), expectedGeneration: text(record(view.grant).generation) }, coordinator.token);
      await observe(async () => record((await fixture.data(operations.grant, target, undefined, owner)).application).membership === 'leave',
        'An agent can remove the collaborator it added');
    }
    const existing = { agentId: agent.id, roomId: collaborationRoom }, previous = await fixture.data(operations.grant, existing);
    await fixture.operation(operations.setGrant, existing,
      { expectedRevision: integer(previous.revision), expectedGeneration: null, accessMode: 'reply', nativeAccess: null, muted: false });
    const protectedGrant = await fixture.data(operations.grant, existing, undefined, coordinator.token);
    assert.deepEqual(protectedGrant.allowedActions, [], 'An agent cannot take over a human-added collaborator');
    contractError(await fixture.raw(grantPath(agent.id), 'DELETE',
      { expectedRevision: integer(protectedGrant.revision), expectedGeneration: text(record(protectedGrant.grant).generation) }, { Authorization: 'Bearer ' + coordinator.token }), 403, 'forbidden');
  });
  await scope.test('controller operations, public projections, delivery revisions and retirement use exact receipts', async () => {
    await fixture.operation(operations.fleets); await fixture.operation(operations.fleetMap, fleetParams); await fixture.operation(operations.fleetStatistics, fleetParams);
    const original = await fleet(); const changed = await fixture.data(operations.changeFleet, fleetParams, { expectedRevision: integer(original.revision), label: 'Resource fleet', controller: { name: 'Contract controller', metadata: { region: 'test' } } }, agent.credential); assert.equal(changed.label, 'Resource fleet');
    const operationId = randomUUID(); await fixture.operation(operations.requestFleetRuntime, fleetParams, { operationId, agentId: null, action: 'stop', expectedRevision: integer(changed.revision), confirmFreshHistory: false });
    await fixture.operation(operations.claimFleetRuntime, { ...fleetParams, operationId }, { connectionId: agent.connectionId }, agent.credential);
    await fixture.operation(operations.receiptFleetRuntime, { ...fleetParams, operationId }, { connectionId: agent.connectionId, status: 'succeeded', errorMessage: null }, agent.credential);
    await fixture.operation(operations.fleetRuntimeOperations, fleetParams);
    await fixture.operation(operations.reportFleetFailure, fleetParams, { episodeId: randomUUID(), agentId: agent.id, sessionId, message: 'Inert contract failure episode' }, agent.credential);
    await fixture.operation(operations.runtimeDecisions, params);
    const current = await fleet(); await fixture.operation(operations.changeFleetDelivery, fleetParams, { expectedRevision: integer(current.revision), enabled: false }, agent.credential);
    const paused = await fleet(); await fixture.operation(operations.changeFleetDelivery, fleetParams, { expectedRevision: integer(paused.revision), enabled: true }, agent.credential);
    await report(true); await fixture.operation(operations.recordFleetNativeStop, { ...fleetParams, agentId: agent.id }, { connectionId: agent.connectionId, runId, receiptId: randomUUID() }, agent.credential);
    const agentView = await fixture.data(operations.agent, params);
    const suspended = await fixture.data(operations.changeAgent, params, { expectedRevision: integer(agentView.revision), status: 'suspended' }); assert.equal(suspended.status, 'suspended');
    await fixture.operation(operations.changeAgent, params, { expectedRevision: integer(suspended.revision), status: 'active' });
    const beforeRemoval = await fleet(); await fixture.operation(operations.removeFleetAgent, { ...fleetParams, agentId: agent.id }, { expectedRevision: integer(beforeRemoval.revision), instanceKey: agent.name }, agent.credential);
    const retired = await fleet(); await fixture.operation(operations.archiveFleet, fleetParams, { expectedRevision: integer(retired.revision) }, agent.credential);
  });
}
