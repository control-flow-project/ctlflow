import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { createInvitationReader } from '@crossfire/adapter-matrix/room/invitation';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { createListenerControl } from '@crossfire/agent-core/listener-control';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { fakeCodex, until } from '../scripts/test-support/listener.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';

test('a resumed shared listener recovers pending rooms and owner DMs without replaying its sync cursor or prompting', { timeout: 180000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release), { services, origin } = fixture;
  const owner = await fixture.member('alice'), outsider = await fixture.member('bob');
  const agent = await fixture.agent(owner.actor, 'ada');
  let unavailable: string | undefined;
  const runtime = await fakeCodex(scope), stop = new AbortController(), control = createListenerControl(async () => {}, reason => { unavailable = reason; });
  const native = (token: string, method: string, path: string, input?: unknown) => nativeOk({ base: origin, token }, method, API + path, input);
  const observer = createInvitationReader();
  assert.equal(value(await observer({ base: origin, token: agent.token }, agent.matrixUserId)).size, 0);
  const room = value(await native(owner.token, 'POST', '/createRoom', { name: 'Samosas', preset: 'private_chat', invite: [agent.matrixUserId] }));
  assert(typeof room.room_id === 'string');
  const roomId = room.room_id;
  const previous = value(await native(agent.token, 'GET', '/sync?timeout=0'));
  assert.equal(typeof previous.next_batch, 'string');
  const cursorFile = join(runtime.directory, 'cursor.json');
  writeJson(cursorFile + '.sync', previous.next_batch);
  for (const suffix of ['', '&full_state=true']) {
    const incremental = value(await native(agent.token, 'GET', '/sync?timeout=0&since=' + segment(String(previous.next_batch)) + suffix));
    assert(!JSON.stringify(incremental.rooms ?? {}).includes(roomId), 'An unchanged pending invite is absent even from full-state incremental sync');
  }
  let ended: unknown, ready = false;
  const receiver = listen({ coordination: createCoordination({ origin, token: agent.token }), settings: {
    instance: 'tests', server_name: 'architecture.localhost', homeserver: origin, owner: owner.accepted.account.userId, max_upload_bytes: 1024 },
    account: { user_id: agent.matrixUserId, access_token: agent.token, device_id: 'CROSSFIRE_AGENT' },
    id: agent.id, release: release.manifest, cursorFile,
    limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 10000, runtime: runtime.runtime, control: control.connection,
    ready: () => { ready = true; },
  }, stop.signal).catch(error => { ended = error; });
  cleanup(scope, async () => { stop.abort(); await receiver; });
  const admitted = (roomId: string) => value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId }))?.membership === 'join';
  await until(() => ready || ended !== undefined, 'Native listener was not initialized', 30000);
  assert.equal(ended, undefined);
  assert.equal(readJson(cursorFile + '.sync'), previous.next_batch, 'Inactive acquisition preserves the consumed timeline cursor');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId })), null, 'Inactive fleet listeners do not accept room invitations');
  control.update({ active: true, input: null });
  await until(() => admitted(roomId) || ended !== undefined, 'Pending room invitation was not accepted', 30000);
  assert.equal(ended, undefined);
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 0, 'Joining is model-free');
  const sent = value(await native(owner.token, 'PUT', '/rooms/' + segment(roomId) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Ada, are you here?' }));
  await until(() => runtime.requests().some(request => request.method === 'turn/start') || ended !== undefined || unavailable !== undefined, 'Owner message was not delivered', 30000);
  assert.equal(unavailable, undefined);
  assert.equal(ended, undefined);
  const delivered = JSON.stringify(runtime.requests().filter(request => request.method === 'turn/start'));
  assert(delivered.includes(String(sent.event_id)));
  assert(delivered.includes('Ada, are you here?'));

  const rejected = value(await native(outsider.token, 'POST', '/createRoom', { preset: 'private_chat', invite: [agent.matrixUserId] }));
  assert(typeof rejected.room_id === 'string');
  const dm = value(await native(owner.token, 'POST', '/createRoom', { preset: 'private_chat', is_direct: true, invite: [agent.matrixUserId] }));
  assert(typeof dm.room_id === 'string');
  const directRoom = dm.room_id;
  const direct = value(await native(owner.token, 'PUT', '/rooms/' + segment(directRoom) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body: 'Owner DM task' }));
  await until(() => admitted(directRoom) || ended !== undefined, 'Owner DM invitation was not accepted', 30000);
  assert.equal(ended, undefined, 'Denied outsider invitation must not stop the listener');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: rejected.room_id })), null);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: directRoom }))?.accessMode, 'reply');
  await until(() => JSON.stringify(runtime.requests()).includes(String(direct.event_id)) || ended !== undefined, 'Direct message was not delivered', 30000);
  assert.equal(ended, undefined);
  await until(() => {
    const receipt = readJson<{ pending: unknown; confirmed: unknown[] }>(runtime.options.receiptFile);
    return receipt.pending === null && receipt.confirmed.length === 0;
  }, 'The exact accepted native input must be retired');
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 2);
});
