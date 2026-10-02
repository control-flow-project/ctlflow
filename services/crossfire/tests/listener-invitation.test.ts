import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { createListenerControl } from '@crossfire/agent-core/listener-control';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { fakeCodex, until } from '../scripts/test-support/listener.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';

test('the shared listener accepts pending rooms and owner DMs without prompts or manual grants', { timeout: 180000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release), { services, origin } = fixture;
  const owner = await fixture.member('alice'), outsider = await fixture.member('bob');
  const agent = await fixture.agent(owner.actor, 'ada');
  let unavailable: string | undefined;
  const runtime = await fakeCodex(scope), stop = new AbortController(), control = createListenerControl(async () => {}, reason => { unavailable = reason; });
  const native = (token: string, method: string, path: string, input?: unknown) => nativeOk({ base: origin, token }, method, API + path, input);
  const room = value(await native(owner.token, 'POST', '/createRoom', { name: 'Samosas', preset: 'private_chat', invite: [agent.matrixUserId] }));
  assert(typeof room.room_id === 'string');
  const roomId = room.room_id;
  let ended: unknown;
  const receiver = listen({ coordination: createCoordination({ origin, token: agent.token }), settings: {
    instance: 'tests', server_name: 'architecture.localhost', homeserver: origin, owner: owner.accepted.account.userId, max_upload_bytes: 1024 },
    account: { user_id: agent.matrixUserId, access_token: agent.token, device_id: 'CROSSFIRE_AGENT' },
    id: agent.id, release: release.manifest, cursorFile: join(runtime.directory, 'cursor.json'),
    limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 10000, runtime: runtime.runtime, control: control.connection,
  }, stop.signal).catch(error => { ended = error; });
  scope.after(async () => { stop.abort(); await receiver; });
  const admitted = (roomId: string) => value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId }))?.membership === 'join';
  await until(() => runtime.requests().some(request => request.method === 'thread/resume') || ended !== undefined, 'Native listener was not initialized', 30000);
  await delay(300);
  assert.equal(ended, undefined);
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
  await delay(300);
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 2);
});
