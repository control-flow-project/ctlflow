import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { FLEET_MAP_LIMITS } from '@crossfire/kernel/fleet-map';
import { readFleetMap } from '@crossfire/domain/fleet/read-map';
import { resolveWakePolicy } from '@crossfire/domain/wake/resolve-policy';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { reportListener } from '@crossfire/domain/listener/report';
import { WAKE_POLICIES } from '@crossfire/contracts/wake';
import { fleetMap as mapSchema, type FleetMapView } from '@crossfire/contracts/schema/fleet-map';
import { fleetMap as mapRepresentation } from '../apps/server/src/http/representation/fleet-map.js';
import { layoutFleetMap, adjacentNode } from '../apps/web/src/fleet-map/layout.js';
import { connectionState, filterMap, highlightedMap, readSelection } from '../apps/web/src/fleet-map/model.js';
import { applicationFixture, value } from './support/application.js';
import { mapFleet } from './support/map-fleet.js';
import { httpFixture } from './support/http.js';

async function preparedMap(scope: Parameters<typeof applicationFixture>[0]) {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const { fleet, instances, ready } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId);
  const other = await fixture.member('alice'), specialist = await fixture.agent(other.actor, 'specialist');
  const rooms = [];
  for (const name of ['Credit review', 'Covenant review', 'Risk review', 'Source documents', 'Unavailable name']) rooms.push(value(await fixture.native.createRoom(admin.member.principal.matrixUserId, name)));
  for (let index = 0; index < instances.length; index++) {
    const id = instances[index]!.agentId!, agent = value(services.directory.agent(id))!;
    const mode = WAKE_POLICIES[index % WAKE_POLICIES.length]!;
    value(changeWakePolicy(services, admin.actor, id, { expectedRevision: agent.principal.revision, mode,
      senderIds: mode === 'selected' ? [specialist.id, other.actor.principalId] : [] }, randomUUID()));
    if (index < 12) value(reportListener(services, { kind: 'agent', principalId: id }, id, randomUUID(), { release: 'test', messagesDelivered: 0, stopped: false }, 'test'));
    if (index === instances.length - 1) continue;
    const roomId = rooms[index % rooms.length]!.roomId, current = value(services.directory.agent(id))!;
    value(await changeRoomGrant(services, admin.actor, { agentId: id, roomId, expectedRevision: current.principal.revision,
      expectedGeneration: null, accessMode: index % 3 === 0 ? 'read' : index % 3 === 1 ? 'reply' : 'custom',
      powerLevel: index % 3 === 2 ? 25 : null, muted: index % 4 === 0 }, randomUUID()));
    if (index % 3 !== 0) value(await reconcileRoomGrant(services, id, roomId));
  }
  const failed = value(services.collection.agentRoomApplications({ agentId: instances[1]!.agentId! }))[0]!;
  value(services.repositories.roomGrantApplication.update({ ...failed, errorCode: 'native', errorMessage: 'Observed native failure' }));
  const removed = value(services.repositories.agentRoomGrant.find({ agentId: instances[2]!.agentId!, roomId: rooms[2]!.roomId }))!;
  value(services.repositories.agentRoomGrant.update({ ...removed, accessMode: 'none', powerLevel: null, revision: removed.revision + 1, accessRevision: removed.accessRevision + 1 }));
  const inactive = value(services.repositories.principal.find({ id: specialist.id }))!;
  value(services.repositories.principal.update({ ...inactive, status: 'suspended' }));
  fixture.native.rooms.delete(rooms[4]!.roomId);
  return { fixture, fleet, instances, ready, other, specialist, rooms };
}

test('fleet map is a complete, scoped, batched projection with canonical wake eligibility and explicit application state', async scope => {
  const { fixture, fleet, instances, specialist, other } = await preparedMap(scope), { services, admin } = fixture;
  let batchGrants = 0, batchWake = 0, activeReads = 0, nativeActive = 0, maximumNative = 0;
  const dependencies = { ...services, roomGrantRead: { ...services.roomGrantRead, forAgents(ids: string[]) { batchGrants++; return services.roomGrantRead.forAgents(ids); } },
    collection: { ...services.collection, roomGrants() { assert.fail('No per-agent grant query'); }, wakeSenders() { assert.fail('No per-agent wake query'); },
      wakeSendersForAgents(ids: string[]) { batchWake++; return services.collection.wakeSendersForAgents(ids); } },
    directory: { ...services.directory, activePrincipals() { activeReads++; return services.directory.activePrincipals(); } },
    matrix: { ...services.matrix, async room(matrixId: string, roomId: string) {
      nativeActive++; maximumNative = Math.max(maximumNative, nativeActive);
      try { await setTimeout(2); return await services.matrix.room(matrixId, roomId); } finally { nativeActive--; }
    } } };
  const snapshot = value(await readFleetMap(dependencies, admin.actor, fleet.id));
  const map = value(mapSchema(mapRepresentation(snapshot)));
  assert.equal(map.agents.length, 24); assert.equal(map.connections.length, 23); assert.equal(map.rooms.length, 5); assert.equal(map.sources.length, 6);
  assert.equal(batchGrants, 1); assert.equal(batchWake, 1); assert.equal(activeReads, 1); assert(maximumNative <= 4); assert(maximumNative > 1);
  assert.equal(map.rooms.find(room => room.name === null)?.alias, null);
  assert.equal(map.connections.filter(connection => connection.agentId === instances[23]!.agentId).length, 0);
  for (const agent of snapshot.agents) {
    const source = snapshot.sources.find(entry => entry.sourceId === agent.sourceId)!;
    const matrixIds = snapshot.principals.filter(principal => source.eligiblePrincipalIds.includes(principal.principalId) && principal.principalId !== agent.record.principal.id)
      .map(principal => principal.matrixUserId).sort();
    assert.deepEqual(matrixIds, value(resolveWakePolicy(services, agent.record)).senders);
  }
  const selected = map.sources.find(source => source.mode === 'selected')!;
  assert(selected.selectedPrincipalIds.includes(specialist.id)); assert(!selected.eligiblePrincipalIds.includes(specialist.id));
  assert(selected.eligiblePrincipalIds.includes(other.actor.principalId));
  assert(map.connections.some(connection => connectionState(connection).status === 'failed'));
  assert(map.connections.some(connection => connectionState(connection).status === 'pending'));
  assert(map.connections.some(connection => connectionState(connection).status === 'applied'));
  assert(map.connections.some(connection => connectionState(connection).muted));
  assert(map.connections.some(connection => connectionState(connection).removing));
  const applied = map.connections.find(connection => connectionState(connection).status === 'applied')!;
  assert.deepEqual(connectionState({ ...applied, application: { ...applied.application!, membership: 'leave' } }),
    { ...connectionState(applied), notJoined: true });
  assert.equal(map.agents.filter(agent => agent.listener === 'online').length, 12);
  fixture.advance(90001);
  assert(value(await readFleetMap(services, admin.actor, fleet.id)).agents.every(agent => agent.activity.status === 'offline'));
  const denied = await readFleetMap(services, other.actor, fleet.id); assert(!denied.ok); assert.equal(denied.error.code, 'forbidden');
  assert(!mapSchema({ ...map, agents: [...map.agents, map.agents[0]!] }).ok);
  assert(!mapSchema({ ...map, connections: [{ ...map.connections[0]!, roomId: '!not-in-this-map' }] }).ok);
  assert(!mapSchema({ ...map, secrets: 'not-allowed' }).ok);
  const credit = map.rooms.find(room => room.name === 'Credit review')!;
  const ownerMembership = fixture.native.rooms.get(credit.roomId)!.members.get(admin.member.principal.matrixUserId)!;
  ownerMembership.membership = 'leave';
  const pending = map.connections.find(connection => connection.roomId === credit.roomId && connection.application?.membership !== 'join')!;
  const observed = value(await readFleetMap({ ...services, matrix: { ...services.matrix, async room(matrixId, roomId) {
    if (roomId === credit.roomId) assert.notEqual(matrixId, map.agents.find(agent => agent.agentId === pending.agentId)!.matrixUserId,
      'Use a known joined agent, not a pending observer, when the owner is absent');
    return services.matrix.room(matrixId, roomId);
  } } }, admin.actor, fleet.id));
  assert.equal(observed.rooms.find(room => room.roomId === credit.roomId)!.name, 'Credit review');
});

test('fleet map authorization is rechecked after native reads, and oversized/incomplete rosters are never partial successes', async scope => {
  const { fixture, fleet, instances } = await preparedMap(scope), { services, admin } = fixture;
  const tooMany = await readFleetMap({ ...services, collection: { ...services.collection,
    fleetInstances() { return { ok: true, value: Array.from({ length: FLEET_MAP_LIMITS.agents + 1 }, () => value(services.collection.fleetInstances(fleet))[0]!) }; } } }, admin.actor, fleet.id);
  assert(!tooMany.ok); assert.equal(tooMany.error.code, 'limit');
  const incomplete = await readFleetMap({ ...services, directory: { ...services.directory, agents(input) {
    const result = services.directory.agents(input); return result.ok ? { ok: true, value: { ...result.value, totalItems: result.value.totalItems - 1 } } : result;
  } } }, admin.actor, fleet.id);
  assert(!incomplete.ok); assert.equal(incomplete.error.code, 'unavailable');
  let revoked = false;
  const changed = await readFleetMap({ ...services, matrix: { ...services.matrix, async room(matrixId, roomId) {
    const observed = await services.matrix.room(matrixId, roomId);
    if (!revoked) { revoked = true; value(services.repositories.principal.update({ ...admin.member.principal, status: 'suspended' })); }
    return observed;
  } } }, admin.actor, fleet.id);
  assert(!changed.ok); assert.equal(changed.error.code, 'forbidden'); assert.equal(instances.length, 24);
});

function assertGeometry(map: FleetMapView, width: number) {
  const layout = layoutFleetMap(map, width);
  assert.equal(layout.nodes.length, map.agents.length + map.rooms.length + map.sources.length);
  assert.equal(layout.edges.length, map.agents.length + map.connections.length);
  for (const node of layout.nodes) {
    assert(node.x >= 0 && node.y >= 0 && node.x + node.width <= layout.width && node.y + node.height <= layout.height);
    for (const other of layout.nodes) if (other.key !== node.key) assert(node.x + node.width <= other.x || other.x + other.width <= node.x
      || node.y + node.height <= other.y || other.y + other.height <= node.y, node.key + ' overlaps ' + other.key);
  }
  for (const edge of layout.edges) {
    assert(!edge.path.includes('NaN')); assert(!edge.path.includes('Infinity'));
    const from = layout.nodes.find(node => node.key === edge.from)!, to = layout.nodes.find(node => node.key === edge.to)!;
    assert.equal(edge.points[0]!.x, from.x + from.width); assert.equal(edge.points.at(-1)!.x, to.x);
    for (let index = 1; index < edge.points.length; index++) {
      const start = edge.points[index - 1]!, end = edge.points[index]!;
      for (const node of layout.nodes) {
        const intersects = start.x === end.x ? start.x > node.x && start.x < node.x + node.width
          && Math.max(start.y, end.y) > node.y && Math.min(start.y, end.y) < node.y + node.height
          : start.y > node.y && start.y < node.y + node.height && Math.max(start.x, end.x) > node.x && Math.min(start.x, end.x) < node.x + node.width;
        assert(!intersects, edge.key + ' cuts through ' + node.key);
      }
    }
  }
  assert.deepEqual(layout, layoutFleetMap({ ...map, agents: [...map.agents].reverse(), rooms: [...map.rooms].reverse(), sources: [...map.sources].reverse() }, width));
  return layout;
}

test('functional fleet layout is deterministic, dense, node-safe and adapts to content width; filters and selection preserve isolated agents', async scope => {
  const { fixture, fleet } = await preparedMap(scope);
  const map = value(mapSchema(mapRepresentation(value(await readFleetMap(fixture.services, fixture.admin.actor, fleet.id)))));
  const narrow = assertGeometry(map, 320), wide = assertGeometry(map, 1600);
  assert(wide.columns > narrow.columns); assert(wide.height < narrow.height);
  assertGeometry(map, 700); assertGeometry(map, 1100); assertGeometry({ ...map, agents: [], rooms: [], connections: [], sources: [] }, 1600);
  const expanded = Array.from({ length: 100 }, (_, index) => ({ ...map.agents[index % map.agents.length]!, agentId: randomUUID(), instanceKey: 'dense-' + index }));
  const dense: FleetMapView = { ...map, agents: expanded, connections: expanded.map((agent, index) => {
    const connection = map.connections[index % map.connections.length]!;
    return { ...connection, agentId: agent.agentId, grant: connection.grant ? { ...connection.grant, agentId: agent.agentId } : null };
  }) };
  value(mapSchema(dense));
  assertGeometry(dense, 700); assertGeometry(dense, 1600);
  const filtered = filterMap(map, { search: 'worker-23', listener: 'all' });
  assert.equal(filtered.agents.length, 1); assert.equal(filtered.connections.length, 0); assert.equal(filtered.rooms.length, 0); assert.equal(filtered.sources.length, 1);
  assert.equal(filterMap(map, { search: 'no-match', listener: 'all' }).agents.length, 0);
  assert.equal(filterMap(map, { search: '', listener: 'online' }).agents.length, 12);
  assert(filterMap(map, { search: 'Credit review', listener: 'all' }).agents.length > 0);
  const agent = map.agents[0]!, selection = { kind: 'agent' as const, id: agent.agentId }, highlighted = highlightedMap(map, selection);
  assert(highlighted.nodes.has('agent:' + agent.agentId)); assert(highlighted.nodes.has('source:' + agent.sourceId));
  assert.deepEqual(readSelection('room:!opaque:matrix'), { kind: 'room', id: '!opaque:matrix' }); assert.equal(readSelection('unknown:id'), null);
  const node = wide.nodes.find(entry => entry.kind === 'agent')!;
  assert.notEqual(adjacentNode(wide.nodes, node, 'ArrowRight')?.key, node.key);
});

test('fleet map REST is human-scoped, strictly validated, read-only and excludes controller credentials', async scope => {
  const { fixture, fleet, ready, other } = await preparedMap(scope), { request } = await httpFixture(scope, fixture.application);
  const route = '/api/fleets/' + fleet.id + '/map';
  assert.equal((await request(route)).status, 401);
  assert.equal((await request(route, 'GET', undefined, { Cookie: 'crossfire=' + other.secret })).status, 403);
  assert.equal((await request(route, 'GET', undefined, { Authorization: 'Bearer ' + ready.fleet!.controllerCredential })).status, 401);
  const headers = { Cookie: 'crossfire=' + fixture.admin.secret };
  const response = await request(route, 'GET', undefined, headers); assert.equal(response.status, 200);
  const raw = await response.json() as { data: unknown }, map = value(mapSchema(raw.data));
  assert.equal(map.agents.length, 24); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await request(route + '?page=1', 'GET', undefined, headers)).status, 400);
  assert.equal((await request(route, 'POST', {}, headers)).status, 405);
  assert(!JSON.stringify(raw).includes(ready.fleet!.controllerCredential!));
  assert(!JSON.stringify(raw).includes('provisioningPassword'));
});
