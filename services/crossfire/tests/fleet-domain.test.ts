import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { applicationFixture, value, secret } from './support/application.js';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { reconcilePrincipal } from '@crossfire/domain/principal/reconcile';
import { authenticateController } from '@crossfire/domain/fleet/authority';
import { changeFleet, bindFleetAgent, removeFleet } from '@crossfire/domain/fleet/change-fleet';
import { listFleetAgents, listFleets, readFleet } from '@crossfire/domain/fleet/read-fleet';
import { previewGrantPlan, applyGrantPlan } from '@crossfire/domain/room-access/grant-plan';
import { changeInstancePolicy } from '@crossfire/domain/policy/change-policy';

test('twenty-instance approval, scoped controller, and same-key fleets retain exact authority', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const current = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  const { id: _id, revision, ...settings } = current;
  value(changeInstancePolicy(services, admin.actor, { ...settings, expectedRevision: revision, maxOwnerAgents: 100, maxAgents: 1000 }, randomUUID()));
  const other = await fixture.member('other');
  async function enroll(owner: typeof admin, count: number, prefix: string) {
    const request = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: owner.member.principal.matrixUserId,
      fleetKey: 'research', controller: { name: prefix + '-computer', metadata: { site: prefix } },
      instances: Array.from({ length: count }, (_, index) => ({ instanceKey: 'worker-' + index, name: prefix + '-' + index })) };
    const introduced = value(await introduceEnrollment(services, request));
    value(decideEnrollment(services, owner.actor, request.enrollmentId,
      { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    for (const item of value(services.collection.enrollmentItems({ requestId: request.enrollmentId }))) value(await reconcilePrincipal(services, item.agentId!));
    const ready = value(exchangeEnrollment(services, request.enrollmentId, request.claimSecret));
    assert.equal(ready.status, 'ready'); assert.equal(ready.instances.length, count);
    return ready;
  }
  const first = await enroll(admin, 20, 'north'), second = await enroll(other, 1, 'south');
  const fleetId = first.fleet!.fleetId, controller = value(authenticateController(services, first.fleet!.controllerCredential!));
  const expectedRevision = () => value(readFleet(services, controller, fleetId)).revision;
  const page = { page: 1, pageSize: 7 };
  const members = value(listFleetAgents(services, controller, fleetId, page));
  assert.equal(members.totalItems, 20); assert.equal(members.items.length, 7);
  assert(members.items.every(item => item.agent.allowedActions.length === 0));
  assert.equal(value(listFleets(services, admin.actor, { page: 1, pageSize: 20 })).totalItems, 2);
  assert.equal(value(listFleets(services, other.actor, { page: 1, pageSize: 20 })).totalItems, 1);
  assert.equal(readFleet(services, controller, second.fleet!.fleetId).ok, false);
  value(changeFleet(services, controller, fleetId, { expectedRevision: expectedRevision(), label: 'Research', controller: { name: 'Laptop', metadata: { zone: 'desk' } } }, randomUUID()));
  assert.equal(removeFleet(services, controller, fleetId, expectedRevision(), randomUUID()).ok, false);
  const audit = value(services.collection.audits({ page: 1, pageSize: 100 })).items.find(item => item.action === 'fleet.configure')!;
  assert.equal(audit.actorKind, 'controller'); assert.equal(audit.actorPrincipalId, null); assert.equal(audit.actorCredentialId, controller.credentialId);
  const agent = first.instances[0]!;
  value(await bindFleetAgent(services, controller, fleetId, agent.agentId!, { expectedRevision: expectedRevision(), instanceKey: agent.instanceKey, remove: true }, randomUUID()));
  assert.equal(value(services.directory.agent(agent.agentId!))!.principal.status, 'active');
  assert.equal((await bindFleetAgent(services, controller, fleetId, agent.agentId!,
    { expectedRevision: expectedRevision(), instanceKey: agent.instanceKey, remove: false, accessToken: secret() }, randomUUID())).ok, false);
  value(await bindFleetAgent(services, controller, fleetId, agent.agentId!,
    { expectedRevision: expectedRevision(), instanceKey: agent.instanceKey, remove: false, accessToken: agent.account!.accessToken }, randomUUID()));
  const roomId = value(await fixture.native.matrix.createRoom(admin.member.principal.matrixUserId, 'Research')).roomId;
  const plan = { fleetId, agents: first.instances.map(instance => ({ instanceKey: instance.instanceKey,
    grants: [{ roomId, accessMode: 'reply' as const, powerLevel: null, muted: false }] })) };
  const preview = value(await previewGrantPlan(services, admin.actor, plan));
  assert.equal(preview.snapshots.length, 20); assert.equal(preview.changes.length, 20);
  value(await applyGrantPlan(services, admin.actor, { plan, digest: preview.digest, snapshots: preview.snapshots }, randomUUID()));
  for (const instance of first.instances) assert.equal(value(services.collection.roomGrants({ agentId: instance.agentId! })).length, 1);
  assert.equal(value(services.collection.roomGrants({ agentId: second.instances[0]!.agentId! })).length, 0);
  const credential = value(services.repositories.fleetCredential.find({ id: controller.credentialId }))!;
  value(services.repositories.fleetCredential.update({ ...credential, revokedAt: fixture.now() }));
  assert.equal(authenticateController(services, first.fleet!.controllerCredential!).ok, false);
  assert.equal(changeFleet(services, controller, fleetId, { expectedRevision: 3, label: 'Stale authority', controller: { name: 'Laptop' } }, randomUUID()).ok, false);
});
