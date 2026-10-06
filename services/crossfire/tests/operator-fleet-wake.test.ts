import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { fleetWakePlan, reviewFleetWake } from '../tools/fleet-wake.js';
import { inspect } from '../tools/main.js';
import { operatorFixture } from './support/operator.js';
import { value, secret } from './support/application.js';

async function enrolled(fixture: Awaited<ReturnType<typeof operatorFixture>>, owner = fixture.admin) {
  const { services } = fixture, enrollmentId = randomUUID(), claimSecret = secret();
  const introduced = value(await introduceEnrollment(services, { enrollmentId, claimSecret, ownerMatrixId: owner.member.principal.matrixUserId,
    fleetKey: 'research', controller: { name: 'laptop' }, instances: [{ instanceKey: 'first', name: 'first', coordinationPolicy: defaultCoordinationPolicy() }, { instanceKey: 'second', name: 'second', coordinationPolicy: defaultCoordinationPolicy() }] }));
  value(decideEnrollment(services, owner.actor, enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
  for (const item of value(services.collection.enrollmentItems({ requestId: enrollmentId }))) value(await reconcilePrincipal(services, item.agentId!));
  const ready = value(exchangeEnrollment(services, enrollmentId, claimSecret));
  const plan = value(fleetWakePlan({ fleetId: ready.fleet!.fleetId, fleetKey: 'research', ownerMatrixId: owner.member.principal.matrixUserId,
    controllerName: 'laptop', instances: ready.instances.map(instance => ({ instanceKey: instance.instanceKey, name: instance.name, mode: 'owner-agents', senderIds: [] })) }));
  return { ready, plan };
}
const signal = () => new AbortController().signal;

test('fleet wake plans validate exact complete identities and canonical modes without coercion', async scope => {
  const fixture = await operatorFixture(scope), { plan } = await enrolled(fixture), entry = plan.instances[0]!;
  for (const invalid of [{ ...plan, instances: [] }, { ...plan, fleetId: 'research' }, { ...plan, extra: true },
    { ...plan, instances: [entry, entry] }, { ...plan, instances: [entry, { ...entry, instanceKey: 'unique' }] },
    { ...plan, instances: [entry, { ...entry, name: 'unique' }] }, { ...plan, instances: [{ ...entry, mode: 'agents' }] },
    { ...plan, instances: [{ ...entry, senderIds: [randomUUID()] }] },
    { ...plan, instances: [{ ...entry, mode: 'selected', senderIds: [plan.fleetId, plan.fleetId] }] },
    { ...plan, instances: [{ ...entry, mode: 'selected', senderIds: ['@name:example.test'] }] },
    { ...plan, instances: Array.from({ length: 101 }, (_, index) => ({ ...entry, name: 'name-' + index, instanceKey: 'key-' + index })) }]) {
    assert.equal(fleetWakePlan(invalid).ok, false);
  }
  for (const args of [[], ['fleet-wake', '--execute'], ['fleet-wake', '--unknown'], ['fleet-wake', '--origin', 'http://localhost', '--origin', 'http://localhost']]) assert.equal((await inspect(args, signal())).ok, false);
});

test('fleet wake review is nonmutating and execution preserves grants, identities and native state', async scope => {
  const fixture = await operatorFixture(scope), { services, admin, native } = fixture, { plan, ready } = await enrolled(fixture);
  const outsider = await fixture.member('outsider'), foreign = await fixture.agent(outsider.actor, 'foreign'), peer = await fixture.agent(admin.actor, 'peer');
  const firstId = ready.instances[0]!.agentId!, secondId = ready.instances[1]!.agentId!;
  const roomId = value(await native.createRoom(admin.member.principal.matrixUserId, 'Research')).roomId;
  value(await changeRoomGrant(services, admin.actor, { agentId: firstId, roomId, expectedRevision: value(services.directory.agent(firstId))!.principal.revision,
    expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID()));
  value(await reconcileRoomGrant(services, firstId, roomId));
  const beforeGrants = value(services.collection.roomGrants({ agentId: firstId })), beforeNative = structuredClone([...native.rooms]);
  const reviewed = value(await reviewFleetWake(fixture.origin, fixture.account, plan, false, signal()));
  assert.equal(reviewed.executed, false); assert.equal(reviewed.changed, 0);
  assert(reviewed.instances.every(instance => instance.before.mode === 'owner' && instance.changeRequired));
  assert.equal(fixture.requests.filter(request => request.method === 'PUT').length, 0);
  const applied = value(await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal()));
  assert.equal(applied.executed, true); assert.equal(applied.changed, 2);
  for (const instance of ready.instances) {
    const resolved = value(deliveryPolicy(services, { kind: 'agent', principalId: instance.agentId! }, instance.agentId!));
    assert.equal(resolved.wake.mode, 'owner-agents');
    assert.deepEqual(resolved.wake.senders, [admin.member.principal.matrixUserId, peer.matrixUserId,
      ready.instances.find(other => other.agentId !== instance.agentId)!.account!.matrixUserId].sort());
    assert(!resolved.wake.senders.includes(foreign.matrixUserId));
  }
  assert.deepEqual(value(services.collection.roomGrants({ agentId: firstId })), beforeGrants);
  assert.deepEqual([...native.rooms], beforeNative);
  assert.deepEqual(applied.instances.map(instance => instance.agentId), [firstId, secondId]);
  assert.equal(value(await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal())).changed, 0);
  assert.equal(fixture.requests.filter(request => request.method === 'PUT').length, 2);
  assert(!JSON.stringify(applied).includes(fixture.admin.token));
});

test('fleet wake preflight refuses wrong identities, partial rosters and invalid selected senders before any write', async scope => {
  const fixture = await operatorFixture(scope), { plan, ready } = await enrolled(fixture), entry = plan.instances[0]!;
  for (const changed of [{ fleetId: randomUUID() }, { ownerMatrixId: '@different:test.localhost' }, { controllerName: 'other' },
    { fleetKey: 'other' }, { instances: [entry] }, { instances: [{ ...entry, name: 'other' }, plan.instances[1]!] },
    { instances: [{ ...entry, mode: 'selected' as const, senderIds: [ready.instances[0]!.agentId!] }, plan.instances[1]!] },
    { instances: [{ ...entry, mode: 'selected' as const, senderIds: [randomUUID()] }, plan.instances[1]!] }]) {
    assert.equal((await reviewFleetWake(fixture.origin, fixture.account, { ...plan, ...changed }, true, signal())).ok, false);
  }
  const principal = value(fixture.services.repositories.principal.find({ id: ready.instances[1]!.agentId! }))!;
  value(fixture.services.repositories.principal.update({ ...principal, status: 'suspended' }));
  assert.equal((await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal())).ok, false);
  assert.equal(fixture.requests.filter(request => request.method === 'PUT').length, 0);
});

test('fleet wake configuration uses all canonical modes including explicit cross-owner selections', async scope => {
  const fixture = await operatorFixture(scope), owner = await fixture.member('owner'), other = await fixture.member('other'), { plan, ready } = await enrolled(fixture, owner);
  const foreign = await fixture.agent(other.actor, 'foreign');
  for (const mode of ['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected'] as const) {
    const configured = { ...plan, instances: plan.instances.map(instance => ({ ...instance, mode, senderIds: mode === 'selected' ? [foreign.id, fixture.admin.actor.principalId] : [] })) };
    const report = value(await reviewFleetWake(fixture.origin, fixture.account, configured, true, signal()));
    assert(report.instances.every(instance => instance.after.mode === mode));
    if (mode === 'selected') for (const instance of ready.instances) assert.deepEqual(value(deliveryPolicy(fixture.services,
      { kind: 'agent', principalId: instance.agentId! }, instance.agentId!)).wake.senders, [foreign.matrixUserId, fixture.admin.member.principal.matrixUserId].sort());
    assert.equal(value(await reviewFleetWake(fixture.origin, fixture.account, configured, true, signal())).changed, 0);
  }
});

test('fleet wake failures report partial writes, stop immediately and support reviewed idempotent continuation', async scope => {
  const fixture = await operatorFixture(scope), { services } = fixture, { plan, ready } = await enrolled(fixture);
  const previous = services.repositories.agent.update, secondId = ready.instances[1]!.agentId!;
  services.repositories.agent.update = record => record.principalId === secondId ? failure('native', 'PRIVATE_TOKEN_' + fixture.admin.token) : previous(record);
  const result = await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /verified writes: first; last attempted: second/);
    assert(!result.error.message.includes(fixture.admin.token));
  }
  assert.equal(value(services.directory.agent(ready.instances[0]!.agentId!))!.agent.wakeMode, 'owner-agents');
  assert.equal(value(services.directory.agent(secondId))!.agent.wakeMode, 'owner');
  services.repositories.agent.update = previous;
  assert.equal(value(await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal())).changed, 1);
});

test('fleet wake refuses stale agent revisions rather than replacing concurrent configuration', async scope => {
  const fixture = await operatorFixture(scope), { services } = fixture, { plan, ready } = await enrolled(fixture);
  const previous = services.repositories.agent.update, firstId = ready.instances[0]!.agentId!, secondId = ready.instances[1]!.agentId!;
  services.repositories.agent.update = record => {
    if (record.principalId === firstId) {
      const principal = value(services.repositories.principal.find({ id: secondId }))!;
      value(services.repositories.principal.update({ ...principal, revision: principal.revision + 1 }));
    }
    return previous(record);
  };
  const result = await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'conflict');
  assert.equal(value(services.directory.agent(secondId))!.agent.wakeMode, 'owner');
});

test('fleet wake cannot report complete success after the fleet changes during writes', async scope => {
  const fixture = await operatorFixture(scope), { services } = fixture, { plan, ready } = await enrolled(fixture);
  const previous = services.repositories.agent.update, secondId = ready.instances[1]!.agentId!;
  services.repositories.agent.update = record => {
    const updated = previous(record);
    if (updated.ok && record.principalId === secondId) {
      const fleet = value(services.repositories.fleet.findById(plan.fleetId))!;
      value(services.repositories.fleet.update({ ...fleet, revision: fleet.revision + 1 }));
    }
    return updated;
  };
  const result = await reviewFleetWake(fixture.origin, fixture.account, plan, true, signal());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'conflict');
    assert.match(result.error.message, /Fleet changed during configuration; verified writes: first, second/);
  }
});
