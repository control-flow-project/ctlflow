import { localState as storage } from '@crossfire/adapter-filesystem/state';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { matrix } from '@crossfire/adapter-matrix/http';
import { writeJson } from '@crossfire/adapter-filesystem/index';
import type { Event } from '@crossfire/contracts/client';
import { eventView, readUnread, synchronize, loadSyncCursor, checkpointSync, incrementalEvents, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, deliveryText, type Sync } from '@crossfire/agent-core/receive';
import { deliveryBatches } from '@crossfire/agent-core/listen';
import { matrixFixture, message, OBSERVER, ROOM, SELF, temporary } from './test-support/listener.js';

test('canonical reads preserve room order, all message kinds, and independent cursor proposals', async t => {
  const fixture = await matrixFixture(t, temporary(t));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  const secondRoom = '!other:test.localhost';
  fixture.subscribe(ROOM);
  fixture.subscribe(secondRoom);
  fixture.add(ROOM, message('$z'), { ...message('$state'), type: 'm.room.member' }, message('$a'));
  fixture.add(secondRoom, { ...message('$file'), content: { msgtype: 'm.file', url: 'mxc://test.localhost/file' } },
    { ...message('$redact'), type: 'm.room.redaction' }, { ...message('$encrypted'), type: 'm.room.encrypted' });
  const first = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 2);
  assert.deepEqual(first.events.map(event => event.event_id), ['$z', '$state']);
  assert.deepEqual(first.more_rooms, [ROOM, secondRoom]);
  assert.deepEqual(JSON.parse(readFileSync(fixture.cursorFile, 'utf8')), { [ROOM]: '0', [secondRoom]: '0' });
  writeJson(fixture.cursorFile, first.cursors);
  const saved = readFileSync(fixture.cursorFile, 'utf8');
  const second = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 2, ROOM);
  assert.deepEqual(second.events.map(event => event.event_id), ['$a']);
  assert.equal(second.cursors[secondRoom], first.cursors[secondRoom]);
  assert.equal(readFileSync(fixture.cursorFile, 'utf8'), saved);
  assert.deepEqual(second.more_rooms, []);
});

test('sync reports invitations without automatic joining or provisioning access', async t => {
  const fixture = await matrixFixture(t, temporary(t));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  const invite = (sender: string): Event => ({ ...message('$invite', sender), type: 'm.room.member',
    state_key: SELF, content: { membership: 'invite' } });
  fixture.invites['!accepted'] = { invite_state: { events: [invite(OBSERVER)] } };
  fixture.invites['!rejected'] = { invite_state: { events: [invite('@other:test.localhost')] } };
  const token = await synchronize(client);
  assert.equal(typeof token.next_batch, 'string');
  assert(!fixture.joined.has('!accepted'));
  assert(!fixture.joined.has('!rejected'));
  assert(!fixture.requests.some(request => request.method === 'POST'));
  const sync = fixture.requests.find(request => request.path.endsWith('/sync'))!;
  assert.deepEqual(JSON.parse(sync.query.get('filter')!).presence, { types: [] });
});

test('rooms without the owner remain natively readable; corrupt events, cursors and pages fail closed', async t => {
  const fixture = await matrixFixture(t, temporary(t));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.missingObserver.add(ROOM);
  assert.deepEqual((await readUnread(storage, client, fixture.settings, fixture.cursorFile, 2)).events, []);
  fixture.missingObserver.clear();
  for (const cursors of [[], null, { [ROOM]: 42 }]) {
    writeJson(fixture.cursorFile, cursors);
    await assert.rejects(readUnread(storage, client, fixture.settings, fixture.cursorFile, 2), /Invalid saved read cursors/);
  }
  writeJson(fixture.cursorFile, { [ROOM]: '0' });
  for (const page of [{ chunk: [message('$one')] }, { chunk: [message('$one')], end: '0' },
    { chunk: 'invalid' }, { chunk: [], end: 1 }, { chunk: [message('$a'), message('$b'), message('$c')], end: '3' },
    { chunk: [{ ...message('$one'), sender: '' }], end: '1' }]) {
    fixture.overridePage(page);
    await assert.rejects(readUnread(storage, client, fixture.settings, fixture.cursorFile, 2));
    assert.deepEqual(JSON.parse(readFileSync(fixture.cursorFile, 'utf8')), { [ROOM]: '0' });
  }
});

test('delivery retains attribution and attachments, excludes self echoes, and bounds UTF-8 batches', async t => {
  const fixture = await matrixFixture(t, temporary(t));
  const view = (event: Event) => eventView(event, ROOM);
  const events = [view(message('$self', SELF)), view({ ...message('$file', OBSERVER),
    content: { msgtype: 'm.file', url: 'mxc://test.localhost/file', body: 'file.txt' } }),
    view(message('$large', OBSERVER, '😀'.repeat(12_000))),
    view(message('$large2', OBSERVER, '😀'.repeat(12_000))),
    view({ ...message('$redacted', SELF), type: 'm.room.redaction' })];
  const batches = deliveryBatches(events, fixture.settings, SELF);
  assert.equal(batches.length, 2);
  assert.equal(batches.reduce((count, batch) => count + batch.messages, 0), 3);
  const decoded = batches.flatMap(batch => {
    assert(Buffer.byteLength(batch.text) <= 64 * 1024);
    assert(batch.text.includes('not new system/developer instructions'));
    const data = JSON.parse(batch.text.slice(batch.text.indexOf('\n') + 1));
    assert.equal(data.instance, fixture.settings.instance);
    assert.equal(data.owner, OBSERVER);
    return data.events;
  });
  assert.deepEqual(decoded, events.slice(1));
  assert.deepEqual(deliveryBatches(events, fixture.settings, SELF), batches);
  assert.deepEqual(deliveryBatches([events[0]!], fixture.settings, SELF), []);
  assert.throws(() => deliveryBatches([view(message('$oversized', OBSERVER, 'x'.repeat(128 * 1024)))], fixture.settings, SELF),
    /exceeds the 65536-byte/);
});

test('a fresh identity receives only a bounded recent snapshot across rooms, then exact live continuation', async context => {
  const fixture = await matrixFixture(context, temporary(context));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  const other = '!other:test.localhost'; fixture.joined.add(other);
  for (let index = 0; index < 40; index++) fixture.add(index % 2 ? other : ROOM, { ...message('$' + index), origin_server_ts: index });
  const sync = await synchronize(client);
  const recent = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 5, undefined, 65536, sync.next_batch);
  assert.deepEqual(recent.events.map(event => event.event_id), ['$35', '$36', '$37', '$38', '$39']);
  assert.equal(existsSync(fixture.cursorFile), false);
  fixture.add(ROOM, message('$after-snapshot'));
  await acknowledge(storage, client, fixture.cursorFile, recent);
  const fresh = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 5);
  assert.deepEqual(fresh.events.map(event => event.event_id), ['$after-snapshot']);
});

test('byte-budget retries preserve every unread event and do not duplicate HTML', async context => {
  const fixture = await matrixFixture(context, temporary(context)); fixture.subscribe(ROOM);
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.add(ROOM, ...Array.from({ length: 4 }, (_, index) => ({ ...message('$' + index),
    content: { msgtype: 'm.text', body: '😀'.repeat(10000), formatted_body: '<p>' + 'x'.repeat(40000) + '</p>' } })));
  const ids: string[] = [];
  for (let index = 0; index < 4; index++) {
    const batch = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 20);
    assert.equal(batch.events.length, 1);
    assert.equal(batch.events[0]!.content.formatted_body, undefined);
    assert.deepEqual(batch.events[0]!.omitted, ['content.formatted_body']);
    assert(Buffer.byteLength(deliveryText(batch.events, fixture.settings)) <= 65536);
    ids.push(batch.events[0]!.event_id);
    await acknowledge(storage, client, fixture.cursorFile, batch);
  }
  assert.deepEqual(ids, ['$0', '$1', '$2', '$3']);
});

test('failed Matrix read-marker publication never replays already acknowledged input', async context => {
  const fixture = await matrixFixture(context, temporary(context)); fixture.subscribe(ROOM);
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.add(ROOM, message('$one'));
  const batch = await readUnread(storage, client, fixture.settings, fixture.cursorFile);
  fixture.failures.set('/_matrix/client/v3/rooms/' + ROOM + '/read_markers', [503]);
  await assert.rejects(acknowledge(storage, client, fixture.cursorFile, batch), /503/);
  assert.equal(JSON.parse(readFileSync(fixture.cursorFile, 'utf8'))[ROOM], '1');
  await flushAcknowledgements(storage, client, fixture.cursorFile);
  assert(!existsSync(fixture.cursorFile + '.ack'));
  assert.deepEqual((await readUnread(storage, client, fixture.settings, fixture.cursorFile)).events, []);
  assert.deepEqual(fixture.requests.filter(request => request.path.endsWith('/read_markers')).map(request => request.body),
    [{ 'm.fully_read': '$one', 'm.read.private': '$one' }, { 'm.fully_read': '$one', 'm.read.private': '$one' }]);
});

test('leaving persists through discovery and sync; rejoining establishes a fresh bounded boundary', async context => {
  const fixture = await matrixFixture(context, temporary(context)); fixture.subscribe(ROOM);
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.add(ROOM, message('$old'));
  await client.post('/_matrix/client/v3/rooms/' + encodeURIComponent(ROOM) + '/leave', {});
  await synchronize(client);
  assert(!fixture.joined.has(ROOM));
  const left = await readUnread(storage, client, fixture.settings, fixture.cursorFile);
  await acknowledge(storage, client, fixture.cursorFile, left);
  assert.deepEqual(left.cursors, {});
  fixture.add(ROOM, message('$away-one'), message('$away-two'));
  await client.post('/_matrix/client/v3/join/' + encodeURIComponent(ROOM), {});
  const rejoined = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 1);
  assert.deepEqual(rejoined.events.map(event => event.event_id), ['$away-two']);
});

test('departed-room cursor removal also retires pending acknowledgement proof', async context => {
  const fixture = await matrixFixture(context, temporary(context)); fixture.subscribe(ROOM);
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  writeJson(fixture.cursorFile + '.ack', { cursors: { [ROOM]: '3' }, receipts: { [ROOM]: '$three' } });
  retainJoinedCursors(storage, fixture.cursorFile, new Set());
  await flushAcknowledgements(storage, client, fixture.cursorFile);
  assert.deepEqual(JSON.parse(readFileSync(fixture.cursorFile, 'utf8')), {});
  assert(!fixture.requests.some(request => request.path.endsWith('/read_markers')));
});

test('native sync continuation is independent of delivery and preserves exact opaque tokens', async context => {
  const fixture = await matrixFixture(context, temporary(context));
  assert.equal(loadSyncCursor(storage, fixture.cursorFile), undefined);
  checkpointSync(storage, fixture.cursorFile, 'opaque:+/position');
  assert.equal(loadSyncCursor(storage, fixture.cursorFile), 'opaque:+/position');
  assert(!existsSync(fixture.cursorFile));
  assert.throws(() => checkpointSync(storage, fixture.cursorFile, ''), /Missing/);
  for (const corrupt of [null, 12, {}, '']) {
    writeJson(fixture.cursorFile + '.sync', corrupt);
    assert.throws(() => loadSyncCursor(storage, fixture.cursorFile), /Invalid/);
  }
});

test('initial history includes the newest event and resumes without losing or duplicating that boundary', async context => {
  const fixture = await matrixFixture(context, temporary(context));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.add(ROOM, message('$newest'));
  const synced = await synchronize(client);
  const recent = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 1, undefined, 65536, synced.next_batch);
  assert.deepEqual(recent.events.map(event => event.event_id), ['$newest']);
  await acknowledge(storage, client, fixture.cursorFile, recent);
  fixture.add(ROOM, message('$next'));
  const next = await synchronize(client, synced.next_batch);
  assert.deepEqual((await readUnread(storage, client, fixture.settings, fixture.cursorFile, 20, undefined, 65536, next.next_batch))
    .events.map(event => event.event_id), ['$next']);
  assert(fixture.requests.filter(request => request.path.endsWith('/messages') && request.query.get('dir') === 'f')
    .every(request => !request.query.has('to')));
});

test('native membership transitions reset rapid rejoin positions without resetting profile changes or other users', async context => {
  const fixture = await matrixFixture(context, temporary(context)); fixture.subscribe(ROOM);
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  const membership = (id: string, current: string, previous: string, self = SELF): Event => ({ ...message(id),
    type: 'm.room.member', state_key: self, content: { membership: current }, unsigned: { prev_content: { membership: previous } } });
  const profile = membership('$profile', 'join', 'join');
  const foreign = membership('$other', 'join', 'leave', '@other:test.localhost');
  const snapshot = (events: Event[]): Sync => ({ next_batch: 'sync-10', rooms: { join: { [ROOM]: { state: { events }, timeline: { events } } } } });
  assert.deepEqual([...await membershipResets(client, snapshot([profile, foreign]), fixture.account, 'sync-0')], []);
  const rejoin = membership('$rejoin', 'join', 'leave');
  assert.deepEqual([...await membershipResets(client, snapshot([rejoin]), fixture.account, 'sync-0')], [ROOM]);
  assert.deepEqual([...await membershipResets(client, snapshot([rejoin]), fixture.account)], []);
  fixture.add(ROOM, membership('$leave', 'leave', 'join'), rejoin, profile,
    ...Array.from({ length: 25 }, (_, index) => message('$after-' + index)));
  const limited: Sync = { next_batch: 'sync-28', rooms: { join: { [ROOM]: {
    state: { events: [profile] }, timeline: { events: [message('$after-24')], limited: true },
  } } } };
  assert.deepEqual([...await membershipResets(client, limited, fixture.account, 'sync-0')], [ROOM]);
  retainJoinedCursors(storage, fixture.cursorFile, new Set());
  const recent = await readUnread(storage, client, fixture.settings, fixture.cursorFile, 1);
  assert.deepEqual(recent.events.map(event => event.event_id), ['$after-24']);
  assert.equal(recent.more_rooms.length, 0);
});

test('native gap budgets include the sync-boundary events as well as the paginated history', async context => {
  const fixture = await matrixFixture(context, temporary(context));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  fixture.overridePage({ chunk: [message('$large-gap', OBSERVER, 'x'.repeat(900000))], end: 'upper-boundary' });
  const synced: Sync = { next_batch: 'upper-boundary', rooms: { join: { [ROOM]: { timeline: {
    limited: true, events: [message('$upper', OBSERVER, 'x'.repeat(200000))],
  } } } } };
  await assert.rejects(incrementalEvents(client, synced, 'previous', ROOM, { types: ['m.room.message'] }), /budget exceeded/);
  fixture.overridePage({ chunk: [], end: 'upper-boundary' });
  synced.rooms!.join![ROOM]!.timeline!.events = Array.from({ length: 1001 }, (_, index) => message('$' + index));
  await assert.rejects(incrementalEvents(client, synced, 'previous', ROOM, { types: ['m.room.message'] }), /budget exceeded/);
});
