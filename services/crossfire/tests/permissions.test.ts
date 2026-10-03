import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { permissions } from '@crossfire/agent-core/permissions';
import type { Permission } from '@crossfire/agent-core/runtime';
import { matrix } from '@crossfire/adapter-matrix/http';
import type { ReceivedEvent } from '@crossfire/agent-core/receive';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { nativeClock } from '@crossfire/adapter-runtime/clock';
import type { Clock } from '@crossfire/agent-core/port';
import { testClock } from '../scripts/test-support/clock.js';
import { success } from '@crossfire/kernel/result';

const owner = '@alice:tests.localhost', self = '@agent-holmes:tests.localhost', room = '!native';
const permission: Permission = { runtime: 'codex', session: 'session', request: 'native-request', action: 'command',
  scope: { command: 'npm install', cwd: '/work/project' },
  choices: [{ label: 'approve once', value: { decision: 'accept' } }, { label: 'deny', value: { decision: 'decline' } }] };

async function fixture(scope: TestContext, expiresMs = 300_000, holdPublication = false, clock: Clock = nativeClock) {
  const stop = new AbortController();
  const announcements: { event: string; content: Record<string, unknown> }[] = [];
  const events = new Map<string, ReceivedEvent>();
  const conversations: string[] = [];
  let conversation: string | null = room;
  const access = { status: 'active', ownerStatus: 'active', grant: true, ownerJoined: true, ownerLevel: 100, agentLevel: 0, messageLevel: 0, roomVersion: '11',
    encrypted: false, public: false, outsider: false };
  let release!: () => void;
  const publication = new Promise<void>(resolve => { release = resolve; });
  if (!holdPublication) release();
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    let body: unknown;
    if (path.endsWith('/owner-conversation')) {
      conversations.push(path); conversation = room;
      body = { data: { roomId: room }, meta: { requestId: '11111111-1111-4111-8111-111111111111' } };
    } else if (path.startsWith('/api/agents/')) body = { data: { agentId: '11111111-1111-4111-8111-111111111111', ownerMatrixId: owner, matrixUserId: self,
      status: access.status, ownerStatus: access.ownerStatus, wakeMode: 'owner', senderMatrixIds: access.status === 'active' && access.ownerStatus === 'active' ? [owner] : [],
      ownerConversation: access.grant ? conversation : null,
      roomGrants: access.grant ? [{ roomId: room, accessMode: 'reply', powerLevel: null, muted: false }] : [] },
      meta: { requestId: '11111111-1111-4111-8111-111111111111' } };
    else if (path.endsWith('/joined_members')) body = { joined: { [self]: {}, ...(access.ownerJoined ? { [owner]: {} } : {}) } };
    else if (path.endsWith('/state')) body = [
      { type: 'm.room.create', state_key: '', sender: owner, content: { room_version: access.roomVersion } },
      { type: 'm.room.power_levels', state_key: '', sender: owner, content: {
        users: { [self]: access.agentLevel, [owner]: access.ownerLevel }, events: { 'm.room.message': access.messageLevel } } },
      { type: 'm.room.join_rules', state_key: '', sender: owner, content: { join_rule: access.public ? 'public' : 'invite' } },
      { type: 'm.room.member', state_key: owner, sender: owner, content: { membership: 'join' } },
      { type: 'm.room.member', state_key: self, sender: self, content: { membership: 'join' } },
      ...(access.encrypted ? [{ type: 'm.room.encryption', state_key: '', sender: owner, content: { algorithm: 'm.megolm.v1.aes-sha2' } }] : []),
      ...(access.outsider ? [{ type: 'm.room.member', state_key: '@third:tests.localhost', sender: owner, content: { membership: 'invite' } }] : []),
    ];
    else if (path.includes('/send/')) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const content = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const event = '$request-' + announcements.length;
      announcements.push({ event, content }); body = { event_id: event };
      await publication;
    } else body = events.get(path.slice(path.lastIndexOf('/') + 1));
    response.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body ?? { errcode: 'M_NOT_FOUND' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup(scope, async () => {
    release(); stop.abort(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address(); assert(address && typeof address === 'object');
  const broker = permissions({ clock, coordination: createCoordination({ origin: 'http://127.0.0.1:' + address.port, token: 'fixture-only' }), client: matrix({ base: 'http://127.0.0.1:' + address.port, token: 'fixture-only', signal: stop.signal }),
    settings: { instance: 'tests', homeserver: 'http://127.0.0.1:' + address.port, server_name: 'tests.localhost', owner, max_upload_bytes: 1024 },
    account: { user_id: self, access_token: 'fixture-only', device_id: 'fixture' }, agent: '11111111-1111-4111-8111-111111111111', expiresMs }, stop.signal);
  async function announced() {
    const deadline = Date.now() + 2000;
    while (!announcements.length) { assert(Date.now() < deadline); await delay(5); }
    return announcements[0]!;
  }
  function reply(target: string, body = 'approve once', sender = owner, selectedRoom = room) {
    const event: ReceivedEvent = { room_id: selectedRoom, event_id: '$reply-' + events.size, sender, type: 'm.room.message', timestamp: undefined,
      content: { msgtype: 'm.text', body, 'm.relates_to': { 'm.in_reply_to': { event_id: target } } } };
    events.set(event.event_id, event); return event;
  }
  return { broker, stop, access, announcements, conversations, events, reply, announced, release,
    noConversation() { conversation = null; } };
}

test('only the verified owner replies once to the exact run-bound request', async scope => {
  const fixture_ = await fixture(scope);
  let decisions = 0;
  const pending = fixture_.broker.request(permission, fixture_.stop.signal).then(result => { decisions++; return result; });
  const announced = await fixture_.announced();
  assert(String(announced.content.body).includes(fixture_.broker.run));
  assert(String(announced.content.body).includes('npm install'));
  assert.equal(await fixture_.broker.consume(fixture_.reply(announced.event, 'approve once', '@admin:tests.localhost')), true);
  assert.equal(await fixture_.broker.consume(fixture_.reply('$another-request')), false);
  assert.equal(await fixture_.broker.consume(fixture_.reply(announced.event, 'approve once', owner, '!different')), false);
  assert.equal(await fixture_.broker.consume(fixture_.reply(announced.event, 'maybe')), true);
  const edited = fixture_.reply(announced.event);
  edited.content['m.new_content'] = { body: 'approve once' };
  assert.equal(await fixture_.broker.consume(edited), false);
  assert.equal(decisions, 0, 'Every unauthorized or unrelated consumption has completed without choosing a decision');
  const accepted = fixture_.reply(announced.event, '> <' + self + '> Permission needed\n> details\n\napprove once');
  assert.equal(await fixture_.broker.consume(accepted), true);
  assert.deepEqual(await pending, success({ decision: 'accept' }));
  assert.equal(await fixture_.broker.consume(accepted), true);
  assert.equal(decisions, 1);
  const duplicate = await fixture_.broker.request(permission, fixture_.stop.signal);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error.message, /Duplicate/);
});

test('permission readiness creates no chat; the first validated request obtains its private owner DM', async scope => {
  const fixture_ = await fixture(scope);
  fixture_.noConversation();
  assert.deepEqual(await fixture_.broker.authorize(), success(undefined));
  assert.deepEqual(fixture_.conversations, []);
  const invalid = await fixture_.broker.request({ ...permission, choices: [] }, fixture_.stop.signal);
  assert.equal(invalid.ok, false);
  assert.deepEqual(fixture_.conversations, []);
  const pending = fixture_.broker.request(permission, fixture_.stop.signal);
  const announcement = await fixture_.announced();
  assert.equal(fixture_.conversations.length, 1);
  assert.equal(await fixture_.broker.consume(fixture_.reply(announcement.event, 'deny')), true);
  assert.deepEqual(await pending, success({ decision: 'decline' }));
  assert.equal(fixture_.stop.signal.aborted, false);
});

test('revocation, absent owner, expiry and disconnect never approve a pending request', async scope => {
  for (const condition of ['grant', 'ownerJoined', 'ownerStatus', 'agentPower', 'ownerPower', 'encrypted', 'public', 'outsider', 'expiry', 'disconnect'] as const) {
    await scope.test(condition, async control => {
      const clock = testClock(control);
      const fixture_ = await fixture(control, condition === 'expiry' ? 1000 : 300_000, false, clock);
      const pending = fixture_.broker.request(permission, fixture_.stop.signal);
      const announced = await fixture_.announced();
      if (condition === 'grant' || condition === 'ownerJoined') fixture_.access[condition] = false;
      if (condition === 'ownerStatus') fixture_.access.ownerStatus = 'suspended';
      if (condition === 'agentPower') fixture_.access.agentLevel = -1;
      if (condition === 'ownerPower') fixture_.access.ownerLevel = -1;
      if (condition === 'encrypted' || condition === 'public' || condition === 'outsider') fixture_.access[condition] = true;
      if (condition === 'expiry') await clock.advance(1000);
      else if (condition === 'disconnect') fixture_.stop.abort();
      else {
        assert.equal(await fixture_.broker.consume(fixture_.reply(announced.event)), true);
      }
      const result = await pending;
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, condition === 'expiry' || condition === 'disconnect' ? 'unavailable' : 'forbidden');
      if (condition !== 'disconnect') assert.equal(fixture_.stop.signal.aborted, false);
    });
  }
});

test('a cancelled native request never creates or publishes an owner conversation', async scope => {
  const fixture_ = await fixture(scope);
  fixture_.noConversation();
  const cancelled = new AbortController();
  cancelled.abort(new Error('Native request was cancelled'));
  const result = await fixture_.broker.request(permission, cancelled.signal);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture_.conversations, []);
  assert.deepEqual(fixture_.announcements, []);
  assert.deepEqual(await fixture_.broker.authorize(), success(undefined));
});

test('approval readiness uses current native powers and recognizes v12 creator authority', async scope => {
  const fixture_ = await fixture(scope);
  assert.deepEqual(await fixture_.broker.authorize(), success(undefined));
  fixture_.access.messageLevel = 50;
  const denied = await fixture_.broker.authorize();
  assert.equal(denied.ok, false);
  fixture_.access.agentLevel = 50;
  fixture_.access.ownerLevel = -1;
  assert.equal((await fixture_.broker.authorize()).ok, false);
  fixture_.access.roomVersion = '12';
  assert.deepEqual(await fixture_.broker.authorize(), success(undefined));
  fixture_.access.grant = false;
  assert.equal((await fixture_.broker.authorize()).ok, false);
  assert.deepEqual(fixture_.announcements, []);
});

test('forged native event snapshots and concurrent replies cannot change the chosen decision', async scope => {
  const fixture_ = await fixture(scope);
  const pending = fixture_.broker.request(permission, fixture_.stop.signal);
  const announced = await fixture_.announced();
  const forged = fixture_.reply(announced.event, 'approve once');
  fixture_.events.set(forged.event_id, { ...forged, sender: '@agent-other:tests.localhost' });
  await fixture_.broker.consume(forged);
  const denied = fixture_.reply(announced.event, 'deny');
  await Promise.all([fixture_.broker.consume(denied), fixture_.broker.consume(denied)]);
  assert.deepEqual(await pending, success({ decision: 'decline' }));
});

test('a reply observed before the announcement HTTP response waits for its exact publication', async scope => {
  const fixture_ = await fixture(scope, 300_000, true);
  const pending = fixture_.broker.request(permission, fixture_.stop.signal);
  const announced = await fixture_.announced();
  let consumed = false;
  const consuming = fixture_.broker.consume(fixture_.reply(announced.event)).then(result => { consumed = true; return result; });
  assert.equal(consumed, false, 'The announcement transport barrier still owns publication');
  fixture_.release();
  assert.equal(await consuming, true);
  assert.deepEqual(await pending, success({ decision: 'accept' }));
});
