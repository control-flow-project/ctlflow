import assert from 'node:assert/strict';
import test from 'node:test';
import { API, segment } from '@crossfire/contracts/matrix';
import { grantView, room as roomView } from '@crossfire/contracts/schema/response';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { reconcileRoomGrant } from '@crossfire/domain/room-access/reconcile-grant';
import { nativeApplication } from './support/native-application.js';
import { httpFixture } from './support/http.js';
import { value } from './support/application.js';

test('room discovery and canonical agent grants retain native authority without general room management', { timeout: 180_000 }, async scope => {
  const fixture = await nativeApplication(scope), { services, admin } = fixture;
  const owner = await fixture.member('alice');
  const inviter = await fixture.agent(admin.actor, 'inviter'), target = await fixture.agent(owner.actor, 'target');
  const http = await httpFixture(scope, fixture.application);
  const adminHeaders = http.headers(admin), ownerHeaders = http.headers(owner);
  const inviterHeaders = { Authorization: 'Bearer ' + inviter.token }, targetHeaders = { Authorization: 'Bearer ' + target.token };
  const adminNative = { base: fixture.native.base, token: admin.token };
  const joined = async (token: string) => value(await nativeOk({ base: fixture.native.base, token }, 'GET', API + '/joined_rooms')).joined_rooms;
  assert.deepEqual(await joined(admin.token), []);
  assert.deepEqual(await joined(inviter.token), []);
  assert.deepEqual(await joined(target.token), []);
  const created = value(await nativeOk(adminNative, 'POST', API + '/createRoom', { name: 'Engineering', preset: 'private_chat' }));
  assert(typeof created.room_id === 'string');
  const roomId = created.room_id, roomPath = '/api/rooms/' + segment(roomId);
  const grantPath = (agentId: string) => '/api/agents/' + agentId + '/room-grants/' + segment(roomId);
  async function grant(agentId: string, headers: Record<string, string>) {
    const response = await http.request(grantPath(agentId), 'GET', undefined, headers);
    assert.equal(response.status, 200, await response.clone().text());
    return value(grantView((await response.json() as { data: unknown }).data));
  }
  async function assign(agentId: string, headers: Record<string, string>) {
    const current = await grant(agentId, headers);
    return http.request(grantPath(agentId), 'PUT', { expectedRevision: current.revision,
      expectedGeneration: current.grant?.generation ?? null, accessMode: 'reply', powerLevel: null, muted: false }, headers);
  }

  await scope.test('deleted operations reject every authentication kind and cannot change native state', async () => {
    for (const headers of [{}, adminHeaders, ownerHeaders, inviterHeaders, targetHeaders]) {
      const creation = await http.request('/api/rooms', 'POST', { name: 'Not created' }, headers);
      assert.equal(creation.status, 405);
      assert.equal(creation.headers.get('allow'), 'GET');
      assert.equal((await http.request(roomPath + '/members', 'GET', undefined, headers)).status, 404);
      for (const targetId of [owner.actor.principalId, inviter.id, target.id]) {
        for (const action of ['invite', 'kick']) {
          assert.equal((await http.request(roomPath + '/membership-changes', 'POST', { targetId, action, reason: '', powerLevel: 0 }, headers)).status, 404);
        }
      }
    }
    assert.deepEqual(await joined(admin.token), [roomId]);
    assert.deepEqual(await joined(owner.token), []);
    assert.deepEqual(await joined(inviter.token), []);
    assert.deepEqual(await joined(target.token), []);
    assert.deepEqual(value(services.collection.roomGrants({ agentId: inviter.id })), []);
    assert.deepEqual(value(services.collection.roomGrants({ agentId: target.id })), []);
  });

  await scope.test('existing-room discovery retains names, native authority and human membership scope', async () => {
    const rooms = await http.request('/api/rooms', 'GET', undefined, adminHeaders);
    assert.equal(rooms.status, 200);
    const directory = await rooms.json() as { data: unknown[]; meta: { totalItems: number } };
    assert.equal(directory.meta.totalItems, 1);
    assert.equal(value(roomView(directory.data[0])).roomId, roomId);
    const response = await http.request(roomPath, 'GET', undefined, adminHeaders);
    assert.equal(response.status, 200);
    const details = value(roomView((await response.json() as { data: unknown }).data));
    assert.equal(details.name, 'Engineering');
    assert.equal(details.authority?.creator, true);
    const otherRooms = await http.request('/api/rooms', 'GET', undefined, ownerHeaders);
    assert.equal(otherRooms.status, 200);
    assert.deepEqual((await otherRooms.json() as { data: unknown[] }).data, []);
    assert.equal((await http.request('/api/rooms')).status, 401);
    assert.equal((await http.request('/api/rooms', 'GET', undefined, inviterHeaders)).status, 401);
  });

  await scope.test('an owner assigns native access and explicitly delegates room-scoped invitations', async () => {
    assert.equal((await assign(inviter.id, adminHeaders)).status, 202);
    value(await reconcileRoomGrant(services, inviter.id, roomId));
    assert.deepEqual(await joined(inviter.token), [roomId]);
    assert.equal((await http.request(grantPath(target.id), 'PUT', { expectedRevision: 0, expectedGeneration: null,
      accessMode: 'reply', powerLevel: null, muted: false }, inviterHeaders)).status, 403);
    const current = await grant(inviter.id, adminHeaders);
    assert(current.grant);
    assert.equal((await http.request(grantPath(inviter.id) + '/permissions', 'PUT', {
      expectedRevision: current.revision, expectedGeneration: current.grant.generation, permissions: ['room.agent.invite'],
    }, adminHeaders)).status, 202);
    assert.deepEqual((await grant(inviter.id, inviterHeaders)).permissions, ['room.agent.invite']);
    assert.equal((await assign(inviter.id, inviterHeaders)).status, 403, 'Invitation permission cannot grant self-access');
  });

  await scope.test('the sole grant resource supports cross-owner invitations and removal of the inviter’s own addition', async () => {
    assert.equal((await assign(target.id, inviterHeaders)).status, 202);
    value(await reconcileRoomGrant(services, target.id, roomId));
    assert.deepEqual(await joined(target.token), [roomId]);
    const current = await grant(target.id, inviterHeaders);
    assert(current.grant);
    assert.equal(current.grant.addedById, inviter.id);
    assert.equal(current.grant.authorizerId, inviter.id);
    assert.equal(current.application?.membership, 'join');
    assert.equal(current.application?.powerLevel, 0);
    assert.equal((await http.request(grantPath(target.id), 'DELETE', { expectedRevision: current.revision,
      expectedGeneration: current.grant.generation }, inviterHeaders)).status, 202);
    value(await reconcileRoomGrant(services, target.id, roomId));
    assert.deepEqual(await joined(target.token), []);
    assert.equal((await grant(target.id, ownerHeaders)).application?.membership, 'leave');
    assert.deepEqual(await joined(admin.token), [roomId], 'Grant changes do not create rooms');
  });
});
