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

const owner = '@alice:tests.localhost', self = '@agent-holmes:tests.localhost', room = '!native';
const permission: Permission = { runtime: 'codex', session: 'session', request: 'native-request', action: 'command',
  scope: { command: 'npm install', cwd: '/work/project' },
  choices: [{ label: 'approve once', value: { decision: 'accept' } }, { label: 'deny', value: { decision: 'decline' } }] };

async function fixture(scope: TestContext, expiresMs = 300_000, holdPublication = false) {
  const stop = new AbortController();
  const announcements: { event: string; content: Record<string, unknown> }[] = [];
  const events = new Map<string, ReceivedEvent>();
  const access = { status: 'active', ownerStatus: 'active', grant: true, ownerJoined: true };
  let release!: () => void;
  const publication = new Promise<void>(resolve => { release = resolve; });
  if (!holdPublication) release();
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    let body: unknown;
    if (path.startsWith('/api/agents/')) body = { data: { agentId: '11111111-1111-4111-8111-111111111111', ownerMatrixId: owner, matrixUserId: self,
      status: access.status, ownerStatus: access.ownerStatus, wakeMode: 'owner', senderMatrixIds: access.status === 'active' && access.ownerStatus === 'active' ? [owner] : [],
      roomGrants: access.grant ? [{ roomId: room, accessMode: 'reply', powerLevel: null, muted: false }] : [] },
      meta: { requestId: '11111111-1111-4111-8111-111111111111' } };
    else if (path.endsWith('/joined_members')) body = { joined: { [self]: {}, ...(access.ownerJoined ? { [owner]: {} } : {}) } };
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
  scope.after(async () => {
    release(); stop.abort(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address(); assert(address && typeof address === 'object');
  const broker = permissions({ coordination: createCoordination({ origin: 'http://127.0.0.1:' + address.port, token: 'fixture-only' }), client: matrix({ base: 'http://127.0.0.1:' + address.port, token: 'fixture-only', signal: stop.signal }),
    settings: { instance: 'tests', homeserver: 'http://127.0.0.1:' + address.port, server_name: 'tests.localhost', owner, max_upload_bytes: 1024 },
    account: { user_id: self, access_token: 'fixture-only', device_id: 'fixture' }, agent: '11111111-1111-4111-8111-111111111111', room, expiresMs }, stop.signal);
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
  return { broker, stop, access, announcements, events, reply, announced, release };
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
  await delay(20); assert.equal(decisions, 0);
  const accepted = fixture_.reply(announced.event, '> <' + self + '> Permission needed\n> details\n\napprove once');
  assert.equal(await fixture_.broker.consume(accepted), true);
  assert.deepEqual(await pending, { decision: 'accept' });
  assert.equal(await fixture_.broker.consume(accepted), true);
  assert.equal(decisions, 1);
  await assert.rejects(fixture_.broker.request(permission, fixture_.stop.signal), /Duplicate/);
});

test('revocation, absent owner, expiry and disconnect never approve a pending request', async scope => {
  for (const condition of ['grant', 'ownerJoined', 'ownerStatus', 'expiry', 'disconnect'] as const) {
    await scope.test(condition, async control => {
      const fixture_ = await fixture(control, condition === 'expiry' ? 1000 : 300_000);
      const pending = fixture_.broker.request(permission, fixture_.stop.signal).catch(error => error);
      const announced = await fixture_.announced();
      if (condition === 'grant' || condition === 'ownerJoined') fixture_.access[condition] = false;
      if (condition === 'ownerStatus') fixture_.access.ownerStatus = 'suspended';
      if (condition === 'expiry') assert(await pending instanceof Error);
      else if (condition === 'disconnect') { fixture_.stop.abort(); assert(await pending instanceof Error); }
      else {
        await assert.rejects(fixture_.broker.consume(fixture_.reply(announced.event)), /authorized|joined/);
        fixture_.stop.abort(); assert(await pending instanceof Error);
      }
    });
  }
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
  assert.deepEqual(await pending, { decision: 'decline' });
});

test('a reply observed before the announcement HTTP response waits for its exact publication', async scope => {
  const fixture_ = await fixture(scope, 300_000, true);
  const pending = fixture_.broker.request(permission, fixture_.stop.signal);
  const announced = await fixture_.announced();
  let consumed = false;
  const consuming = fixture_.broker.consume(fixture_.reply(announced.event)).then(result => { consumed = true; return result; });
  await delay(20); assert.equal(consumed, false);
  fixture_.release();
  assert.equal(await consuming, true);
  assert.deepEqual(await pending, { decision: 'accept' });
});
