import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { matrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import { historyQueries } from '@ctlflow/crossfire-agent-core/history-query';
import { exportResetHistory } from '@ctlflow/crossfire-agent-core/reset-history';
import { historyPage } from '@ctlflow/crossfire-agent-core/history-page';
import { readUnread, acknowledge, loadCursors, eventView, validReadBatch } from '@ctlflow/crossfire-agent-core/receive';
import { matrixFixture, message, OBSERVER, ROOM, temporary } from '../scripts/test-support/listener.js';

test('valid oversized native pages repage from the identical cursor and retain all events until acknowledgment', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)); fixture.subscribe(ROOM);
  const client = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token });
  fixture.add(ROOM, ...Array.from({ length: 45 }, (_, index) => message('$large-' + index, OBSERVER, 'x'.repeat(49336))));
  const before = loadCursors(localState, fixture.cursorFile);
  const batch = await readUnread(localState, client, fixture.settings, fixture.cursorFile, 100, undefined, 65536, undefined, new Set([ROOM]));
  assert.equal(batch.events.length, 45); assert.deepEqual(loadCursors(localState, fixture.cursorFile), before);
  const pages = fixture.requests.filter(request => request.path.endsWith('/messages'));
  assert.deepEqual(pages.slice(0, 3).map(request => [request.query.get('from'), request.query.get('limit')]), [['0', '100'], ['0', '50'], ['0', '25']]);
  await acknowledge(localState, client, fixture.cursorFile, batch);
  assert.equal((await readUnread(localState, client, fixture.settings, fixture.cursorFile, 100)).events.length, 0);
});

test('an event beyond the finite native collection bound fails permanently without moving its exact cursor', async () => {
  const requests: number[] = [];
  const client = { get: async (_path: string, query?: Record<string, string | number>) => {
    assert.equal(query?.from, 'exact-cursor'); requests.push(Number(query?.limit));
    throw Object.assign(new Error('Collection overflow'), { code: 'body_too_large' });
  }, post: async () => { throw new Error('Unexpected mutation'); }, put: async () => { throw new Error('Unexpected mutation'); }, message: () => ({}) };
  await assert.rejects(historyPage(client, ROOM, { dir: 'f', from: 'exact-cursor', limit: 100 }), reason => reason instanceof Error && 'code' in reason && reason.code === 'limit');
  assert.deepEqual(requests, [100, 50, 25, 12, 6, 3, 1]);
});

test('the soft 100-record target includes ten available unseen messages in every authorized room', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const rooms = Array.from({ length: 12 }, (_, index) => '!room-' + index + ':test.localhost');
  for (const room of rooms) { fixture.subscribe(room); fixture.add(room, ...Array.from({ length: 15 }, (_, index) => message('$' + room + '-' + index))); }
  const client = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token });
  const batch = await readUnread(localState, client, fixture.settings, fixture.cursorFile, 100, undefined, 65536, undefined, new Set(rooms));
  assert.equal(batch.events.length, 120);
  assert(rooms.every(room => batch.events.filter(event => event.room_id === room).length === 10));
  assert.deepEqual(batch.more_rooms.toSorted(), rooms.toSorted());
});

test('private file references preserve complete content, hashes, attribution and pending retention', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)), root = fixture.cursorFile + '.messages';
  let now = 1000, busy = false;
  const artifacts = messageArtifacts(localState, root, () => now, () => busy);
  const event = eventView(message('$huge', OBSERVER, '😀'.repeat(100000)), ROOM);
  const pointer = artifacts.prepare([event], JSON.stringify({ events: [event] }), 'delivery', 4096, { owner: OBSERVER });
  assert(Buffer.byteLength(pointer) <= 4096); assert(!pointer.includes('😀'));
  const data = JSON.parse(pointer.split('\n').at(-1)!) as { manifest: string };
  const manifest = JSON.parse(readFileSync(data.manifest, 'utf8')) as { messages: { file: string; bytes: number; sha256: string }[] };
  const entry = manifest.messages[0]!, bytes = readFileSync(entry.file);
  assert.equal(bytes.length, entry.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), event);
  assert.equal(statSync(entry.file).mode & 0o077, 0); assert.equal(statSync(root).mode & 0o077, 0);
  now += 3 * 86400000; artifacts.cleanup(); assert(existsSync(entry.file), 'Unconfirmed references stay pinned');
  artifacts.release(['delivery']); now += 2 * 86400000; busy = true; artifacts.cleanup(); assert(existsSync(entry.file));
  busy = false; artifacts.cleanup(); assert(!existsSync(entry.file)); assert(!existsSync(data.manifest));
});

test('staged acquisition files remain pinned only by live owners and reject changed content', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)), root = fixture.cursorFile + '.messages';
  let now = 1000;
  const protectedFiles = new Set<string>(), artifacts = messageArtifacts(localState, root, () => now, () => false, () => protectedFiles);
  const staged = artifacts.stage([eventView(message('$staged', OBSERVER, 'x'.repeat(100000)), ROOM)]);
  const file = staged[0]!.content_file!.file; protectedFiles.add(file);
  now += 3 * 86400000; artifacts.cleanup(); assert(existsSync(file));
  protectedFiles.clear(); now += 3600000; artifacts.cleanup(); assert(existsSync(file));
  now += 2 * 86400000; artifacts.cleanup(); assert(!existsSync(file));
  const restored = artifacts.stage([eventView(message('$staged', OBSERVER, 'x'.repeat(100000)), ROOM)]);
  localState.write(restored[0]!.content_file!.file, { body: 'changed' });
  assert.throws(() => artifacts.prepare(restored, '', 'changed', 4096, {}), /content is missing or changed/u);
  assert.equal(validReadBatch({ events: [{ ...restored[0], content_file: null }], cursors: {}, latest: {}, more_rooms: [] }), false);
});

test('authorized history browsing does not change unread positions, and catch-up requires its exact acknowledgment', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)); fixture.subscribe(ROOM); fixture.add(ROOM, message('$one'), message('$two'));
  const client = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token });
  const queries = historyQueries({ storage: localState, file: fixture.cursorFile, matrix: client, coordination: fixture.coordination,
    account: fixture.account, settings: fixture.settings, agentId: fixture.id, now: Date.now, publishing: () => false,
    artifacts: messageArtifacts(localState, fixture.cursorFile + '.messages', Date.now) });
  const request = { kind: 'history' as const, limit: 100, direction: 'b' as const, outputBytes: 65536, cursors: { entries: [] } };
  const before = loadCursors(localState, fixture.cursorFile), browsing = await queries.read(request);
  assert(browsing.ok); assert.equal(browsing.value.queryId, null); assert.deepEqual(loadCursors(localState, fixture.cursorFile), before);
  assert.equal((await queries.read({ ...request, room: '!foreign:test.localhost' })).ok, false);
  const unread = await queries.read({ ...request, kind: 'unread' }); assert(unread.ok); assert(unread.value.queryId);
  assert.deepEqual(loadCursors(localState, fixture.cursorFile), before); assert(queries.pending());
  assert.equal((await queries.read({ ...request, kind: 'unread' })).ok, false);
  assert.equal((await queries.acknowledge(randomUUID())).ok, false); assert.deepEqual(loadCursors(localState, fixture.cursorFile), before);
  assert((await queries.acknowledge(unread.value.queryId)).ok); assert(!queries.pending());
  assert.notDeepEqual(loadCursors(localState, fixture.cursorFile), before);
});

test('history continuations page each authorized room independently and expired catch-up cannot advance cursors', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)); fixture.subscribe(ROOM);
  fixture.add(ROOM, ...Array.from({ length: 8 }, (_, index) => message('$page-' + index)));
  let now = Date.now(), observed = 0, delivered = 0;
  const queries = historyQueries({ storage: localState, file: fixture.cursorFile,
    matrix: matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token }), coordination: fixture.coordination,
    account: fixture.account, settings: fixture.settings, agentId: fixture.id, now: () => now, publishing: () => false,
    observed: events => { observed += events.length; }, delivered: events => { delivered += events.length; },
    artifacts: messageArtifacts(localState, fixture.cursorFile + '.messages', () => now) });
  const request = { kind: 'history' as const, room: ROOM, limit: 3, direction: 'b' as const, outputBytes: 65536, cursors: { entries: [] } };
  const first = await queries.read(request); assert(first.ok);
  const firstPage = JSON.parse(first.value.text) as { events: { event_id: string }[]; continuation: { entries: { room: string; cursor: string }[] } };
  const next = await queries.read({ ...request, cursors: firstPage.continuation }); assert(next.ok);
  const secondPage = JSON.parse(next.value.text) as typeof firstPage;
  assert.equal(firstPage.events.length, 3); assert.equal(secondPage.events.length, 3);
  assert(firstPage.events.every(event => !secondPage.events.some(other => other.event_id === event.event_id)));
  assert.equal(observed, 0); assert.equal(delivered, 0);
  const before = loadCursors(localState, fixture.cursorFile), unread = await queries.read({ ...request, kind: 'unread' });
  assert(unread.ok && unread.value.queryId); assert.equal(observed, 3);
  now += 300001; assert.equal((await queries.acknowledge(unread.value.queryId)).ok, false);
  assert.deepEqual(loadCursors(localState, fixture.cursorFile), before); assert.equal(delivered, 0);
  const retried = await queries.read({ ...request, kind: 'unread' }); assert(retried.ok && retried.value.queryId);
  assert((await queries.acknowledge(retried.value.queryId)).ok); assert.equal(delivered, 3);
});

test('catch-up acknowledgment retries its own partially committed native markers without replaying messages', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)); fixture.subscribe(ROOM); fixture.add(ROOM, message('$receipt'));
  const client = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token });
  let rejected = true;
  const transport = { ...client, post: async <Value>(path: string, body: unknown): Promise<Value> => {
    if (rejected && path.endsWith('/read_markers')) throw new Error('Native marker unavailable');
    return client.post<Value>(path, body);
  } };
  const queries = historyQueries({ storage: localState, file: fixture.cursorFile, matrix: transport, coordination: fixture.coordination,
    account: fixture.account, settings: fixture.settings, agentId: fixture.id, now: Date.now, publishing: () => false,
    artifacts: messageArtifacts(localState, fixture.cursorFile + '.messages', Date.now) });
  const result = await queries.read({ kind: 'unread', limit: 100, direction: 'b', outputBytes: 65536, cursors: { entries: [] } });
  assert(result.ok && result.value.queryId);
  await assert.rejects(queries.acknowledge(result.value.queryId), /marker unavailable/u);
  assert.equal(loadCursors(localState, fixture.cursorFile)[ROOM], '1'); assert(queries.pending());
  rejected = false;
  assert((await queries.recover()).ok); assert(!queries.pending());
  assert.equal((await readUnread(localState, client, fixture.settings, fixture.cursorFile, 100)).events.length, 0);
});

test('reset exports capture complete authorized history before committing a fresh-context high-water boundary', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)); fixture.subscribe(ROOM);
  fixture.add(ROOM, ...Array.from({ length: 125 }, (_, index) => message('$reset-' + index)));
  const client = matrix({ base: fixture.settings.homeserver, token: fixture.account.access_token }), root = fixture.cursorFile + '.reset';
  const options = { resetId: randomUUID(), root, storage: localState, matrix: client, coordination: fixture.coordination,
    account: fixture.account, settings: fixture.settings, agentId: fixture.id, runtime: 'codex', runtimeOptions: { model: 'fixture' },
    historyMode: 'shared' as const, signal: new AbortController().signal };
  const before = loadCursors(localState, fixture.cursorFile), result = await exportResetHistory(options);
  const bundle = JSON.parse(readFileSync(result.manifest, 'utf8')) as { complete: boolean; rooms: { room: string; pages: { count: number; file: string }[] }[] };
  assert(bundle.complete); assert.equal(bundle.rooms[0]!.pages.reduce((count, page) => count + page.count, 0), 125);
  assert.deepEqual(loadCursors(localState, fixture.cursorFile), before);
  assert(!readFileSync(root + '/configuration.json', 'utf8').includes(fixture.account.access_token));
  assert.deepEqual(await exportResetHistory(options), result);
  localState.write(root + '/configuration.json', { changed: true });
  await assert.rejects(exportResetHistory(options), /content is missing or changed/u);
});
