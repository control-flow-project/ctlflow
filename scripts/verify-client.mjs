import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
const input = JSON.parse(readFileSync(0, 'utf8'));
const skill = join(input.skill, 'scripts');
const paths = JSON.parse(readFileSync(join(skill, '.client-paths.json'), 'utf8'));
const CONFIG = process.env.CROSSFIRE_CLIENT_CONFIG_DIR || paths.config_dir;
const STATE = process.env.CROSSFIRE_CLIENT_STATE_DIR || paths.state_dir;
const { API, Matrix, MatrixError, segment } = await import(input.library);
const run = 'verify-' + Date.now().toString(36);
const firstAgent = run + '-a', secondAgent = run + '-b';
const dir = join(STATE, 'verification', run);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const settings = (id) => JSON.parse(readFileSync(join(CONFIG, 'instances', id + '.json'), 'utf8'));
const account = (id, agent) => JSON.parse(readFileSync(join(CONFIG, 'accounts', id, agent + '.json'), 'utf8'));
function invoke(id, agent, ...args) {
  const result = spawnSync(process.execPath, [join(skill, 'chat.mjs'), '--instance', id, '--agent', agent, ...args], { encoding: 'utf8', cwd: dir });
  if (result.status !== 0) throw new Error(result.stderr || 'Client command failed');
  return JSON.parse(result.stdout);
}
function send(id, agent, selectedRoom, text, transaction = randomUUID()) {
  return { room_id: selectedRoom, ...invoke(id, agent, 'matrix', 'send-message', '--room-id', selectedRoom, '--event-type', 'm.room.message', '--txn-id', transaction, '--markdown', text) };
}
function drain(id, agent, selectedRoom, limit = '100') {
  const events = [];
  for (let page = 0; page < 100; page++) {
    const value = invoke(id, agent, 'agent', 'read', '--room', selectedRoom, '--limit', limit);
    events.push(...value.events);
    if (!value.more) return events;
  }
  throw new Error('Cursor did not drain');
}
function history(id, agent, selectedRoom) {
  return invoke(id, agent, 'matrix', 'get-room-events', '--room-id', selectedRoom, '--dir', 'b', '--limit', '100', '--view', 'messages').chunk;
}
const first = settings(input.instance), second = settings(input.secondary);
const firstDefault = first.rooms.find((selectedRoom) => selectedRoom.alias === first.default_room);
const secondDefault = second.rooms.find((selectedRoom) => selectedRoom.alias === second.default_room);
const extra = first.rooms.find((selectedRoom) => selectedRoom.alias !== first.default_room);
assert(extra);
assert.notEqual(first.homeserver, second.homeserver);
assert.notEqual(first.server_name, second.server_name);
for (const id of [input.instance, input.secondary]) for (const agent of [firstAgent, secondAgent]) invoke(id, agent, 'agent', 'init');
const firstAccount = account(input.instance, firstAgent), firstPeerAccount = account(input.instance, secondAgent), secondAccount = account(input.secondary, firstAgent);
assert.notEqual(firstAccount.user_id, secondAccount.user_id);
const client = new Matrix(first.homeserver, firstAccount.access_token);
const catalog = invoke(input.instance, firstAgent, 'matrix', 'get-joined-rooms');
for (const selectedRoom of first.rooms) {
  assert(catalog.joined_rooms.includes(selectedRoom.room_id));
  const roomMembers = invoke(input.instance, firstAgent, 'matrix', 'get-joined-members-by-room', '--room-id', selectedRoom.room_id).joined;
  for (const member of [firstAccount.user_id, firstPeerAccount.user_id, first.observer]) assert(member in roomMembers);
  assert.equal(invoke(input.instance, firstAgent, 'matrix', 'get-room-state-with-key', '--room-id', selectedRoom.room_id, '--event-type', 'm.room.name', '--state-key', '').name, selectedRoom.name);
  assert.equal(invoke(input.instance, firstAgent, 'matrix', 'get-room-state-with-key', '--room-id', selectedRoom.room_id, '--event-type', 'm.room.topic', '--state-key', '').topic, selectedRoom.purpose);
  await assert.rejects(client.post(API + '/rooms/' + segment(selectedRoom.room_id) + '/kick', { user_id: first.observer }), (error) => error instanceof MatrixError && error.status === 403);
}
await assert.rejects(new Matrix(first.room_service).get('/_coord/rooms'), (error) => error instanceof MatrixError && error.status === 401);
await assert.rejects(new Matrix(second.room_service, firstAccount.access_token).get('/_coord/rooms'), (error) => error instanceof MatrixError && error.status === 401);
await assert.rejects(client.post(API + '/createRoom', { preset: 'private_chat' }), (error) => error instanceof MatrixError && error.status === 403);
const room = invoke(input.instance, firstAgent, 'agent', 'conversation', '--recipient', secondAgent).room_id;
const dm = send(input.instance, firstAgent, room, 'Verification: observer-inclusive direct conversation.');
const firstDirectRead = invoke(input.instance, secondAgent, 'agent', 'read');
assert(firstDirectRead.events.some((event) => event.event_id === dm.event_id), JSON.stringify({ expected: dm.event_id, read: firstDirectRead }));
const members = (await client.get(API + '/rooms/' + segment(room) + '/joined_members')).joined;
assert.deepEqual(Object.keys(members).sort(), [firstAccount.user_id, firstPeerAccount.user_id, first.observer].sort());
await assert.rejects(client.post(API + '/rooms/' + segment(room) + '/kick', { user_id: first.observer }), (error) => error instanceof MatrixError && error.status === 403);
await assert.rejects(client.put(API + '/rooms/' + segment(room) + '/state/m.room.power_levels', { users: { [firstAccount.user_id]: 100 } }), (error) => error instanceof MatrixError && error.status === 403);
await assert.rejects(client.put(API + '/rooms/' + segment(room) + '/state/m.room.encryption', { algorithm: 'm.megolm.v1.aes-sha2' }), (error) => error instanceof MatrixError && error.status === 403);
await assert.rejects(new Matrix(second.homeserver, firstAccount.access_token).get(API + '/account/whoami'), (error) => error instanceof MatrixError && error.status === 401);
assert.equal(invoke(input.instance, secondAgent, 'agent', 'conversation', '--recipient', firstAgent).room_id, room);
const txn = randomUUID();
assert.equal(send(input.instance, firstAgent, room, 'Idempotent delivery check.', txn).event_id, send(input.instance, firstAgent, room, 'Idempotent delivery check.', txn).event_id);
send(input.instance, firstAgent, firstDefault.room_id, 'Explicit room check.');
const routed = send(input.instance, firstAgent, extra.room_id, 'Native room delivery.');
assert(history(input.instance, secondAgent, extra.room_id).some((event) => event.event_id === routed.event_id));
assert(!drain(input.instance, secondAgent, firstDefault.room_id).some((event) => event.event_id === routed.event_id));
assert(drain(input.instance, secondAgent, extra.alias).some((event) => event.event_id === routed.event_id));
assert.equal(drain(input.instance, secondAgent, extra.alias).length, 0);
assert.throws(() => send(input.instance, firstAgent, '!unknown-room', 'Must not be delivered'));
const bytes = randomBytes(131113), file = join(dir, 'attachment.bin'), download = join(dir, 'received.bin');
writeFileSync(file, bytes, { mode: 0o600 });
const upload = invoke(input.instance, firstAgent, 'matrix', 'upload-content', '--input-file', file, '--filename', 'attachment.bin');
const content = { msgtype: 'm.file', body: 'attachment.bin', url: upload.content_uri, info: { mimetype: 'application/octet-stream', size: bytes.length } };
const attached = invoke(input.instance, firstAgent, 'matrix', 'send-message', '--room-id', room, '--event-type', 'm.room.message', '--body', JSON.stringify(content));
const shared = invoke(input.instance, firstAgent, 'matrix', 'send-message', '--room-id', extra.room_id, '--event-type', 'm.room.message', '--body', JSON.stringify(content));
assert(history(input.instance, secondAgent, extra.room_id).some((event) => event.event_id === shared.event_id));
const mxc = new URL(upload.content_uri);
const mediaArgs = ['matrix', 'get-content-authed', '--server-name', mxc.host, '--media-id', mxc.pathname.slice(1), '--output-file', download];
const received = invoke(input.instance, secondAgent, ...mediaArgs);
assert.equal(received.sha256, createHash('sha256').update(bytes).digest('hex'));
assert.deepEqual(readFileSync(download), bytes);
assert.throws(() => invoke(input.instance, secondAgent, ...mediaArgs));
assert.deepEqual(readFileSync(download), bytes);
drain(input.instance, firstAgent, firstDefault.room_id);
const announcement = send(input.instance, secondAgent, firstDefault.room_id, 'Cursor independence ' + run);
assert(drain(input.instance, firstAgent, firstDefault.room_id, '2').some((event) => event.event_id === announcement.event_id));
assert.equal(drain(input.instance, firstAgent, firstDefault.room_id).length, 0);
assert(drain(input.instance, secondAgent, firstDefault.room_id, '2').some((event) => event.event_id === announcement.event_id));
assert(!drain(input.secondary, firstAgent, secondDefault.room_id).some((event) => event.event_id === announcement.event_id));
const secondClient = new Matrix(second.homeserver, secondAccount.access_token), batch = [];
for (let index = 0; index < 107; index++) {
  const sent = await secondClient.put(API + '/rooms/' + segment(secondDefault.room_id) + '/send/m.room.message/' + run + '-' + index, { msgtype: 'm.notice', body: 'Pagination verification ' + run + ' ' + index });
  batch.push(sent.event_id);
}
const paged = drain(input.secondary, secondAgent, secondDefault.room_id, '100');
assert.deepEqual(paged.filter((event) => batch.includes(event.event_id)).map((event) => event.event_id), batch);
assert.equal(drain(input.secondary, secondAgent, secondDefault.room_id).length, 0);
const cursorPath = join(STATE, input.secondary, secondAgent, 'cursors.json'), saved = readFileSync(cursorPath, 'utf8');
const pageOne = invoke(input.secondary, secondAgent, 'matrix', 'get-room-events', '--room-id', secondDefault.room_id, '--dir', 'b', '--limit', '5');
const pageTwo = invoke(input.secondary, secondAgent, 'matrix', 'get-room-events', '--room-id', secondDefault.room_id, '--dir', 'b', '--limit', '5', '--from', pageOne.end);
assert.equal(pageOne.chunk.length, 5);
assert.equal(pageTwo.chunk.length, 5);
assert(!pageOne.chunk.some((event) => pageTwo.chunk.some((other) => other.event_id === event.event_id)));
assert.equal(readFileSync(cursorPath, 'utf8'), saved);
const search = invoke(input.secondary, secondAgent, 'matrix', 'search', '--body', JSON.stringify({ search_categories: { room_events: { search_term: 'Pagination', filter: { rooms: [secondDefault.room_id], limit: 2 } } } }));
assert(search.search_categories.room_events.results.length > 0);
const inbox = invoke(input.instance, firstAgent, 'matrix', 'sync', '--view', 'inbox');
assert(inbox.count_semantics.includes('not total unread messages'));
invoke(input.instance, firstAgent, 'matrix', 'leave-room', '--room-id', extra.room_id, '--body', '{}');
invoke(input.instance, firstAgent, 'agent', 'read');
invoke(input.instance, firstAgent, 'agent', 'init');
assert(!invoke(input.instance, firstAgent, 'matrix', 'get-joined-rooms').joined_rooms.includes(extra.room_id));
invoke(input.instance, firstAgent, 'matrix', 'join-room-by-id', '--room-id', extra.room_id, '--body', '{}');
assert(invoke(input.instance, firstAgent, 'matrix', 'get-joined-rooms').joined_rooms.includes(extra.room_id));
drain(input.instance, firstAgent, extra.room_id);
for (let index = 0; index < 25; index++) {
  await client.put(API + '/rooms/' + segment(extra.room_id) + '/send/m.room.message/' + run + '-old-' + index,
    { msgtype: 'm.notice', body: 'Old subscription ' + index });
}
invoke(input.instance, firstAgent, 'matrix', 'leave-room', '--room-id', extra.room_id, '--body', '{}');
invoke(input.instance, firstAgent, 'matrix', 'join-room-by-id', '--room-id', extra.room_id, '--body', '{}');
const resumed = send(input.instance, firstAgent, extra.room_id, 'After rapid rejoin');
const recent = invoke(input.instance, firstAgent, 'agent', 'read', '--room', extra.room_id, '--limit', '2');
assert.deepEqual(recent.events.map(event => event.event_id), [resumed.event_id]);
assert.equal(recent.more, false);
for (const selectedRoom of first.rooms) invoke(input.instance, firstAgent, 'matrix', 'leave-room', '--room-id', selectedRoom.room_id, '--body', '{}');
assert.equal(invoke(input.instance, firstAgent, 'agent', 'conversation', '--recipient', secondAgent).room_id, room);
const remaining = invoke(input.instance, firstAgent, 'matrix', 'get-joined-rooms').joined_rooms;
assert(first.rooms.every((selectedRoom) => !remaining.includes(selectedRoom.room_id)));
assert.notEqual(join(STATE, input.instance, firstAgent), join(STATE, input.secondary, firstAgent));
console.log(JSON.stringify({
  ok: true,
  first: input.instance,
  second: input.secondary,
  room,
  dmEvent: dm.event_id,
  fileEvent: attached.event_id,
  checks: ['HTTP messaging', 'observer joined', 'room creation denied', 'observer removal denied', 'permission changes denied', 'encryption denied', 'instance token isolation', 'same-name accounts isolated', 'DM reuse', 'idempotent send', 'binary file roundtrip', 'overwrite refused', 'independent cursors', '107-event pagination', 'initial enrollment', 'native room names and purposes', 'authenticated room catalog', 'explicit native routing', 'shared-room attachments', 'per-room unread positions', 'unknown room rejected', 'history continuation without marking read', 'native search', 'native notification semantics', 'leave survives repeat init', 'explicit rejoin']
}, null, 2));
