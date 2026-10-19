import { messageEvent } from '@ctlflow/crossfire-adapter-matrix/events';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { chatBatches } from '@ctlflow/crossfire-agent-core/chat-batches';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { eventView } from '@ctlflow/crossfire-agent-core/receive';
import { deliveryEvents, resolveSenders } from '@ctlflow/crossfire-agent-core/senders';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';
import { fakeCodex, matrixFixture, message, OBSERVER, ROOM, SELF, temporary, until } from './test-support/listener.js';
import { withClock } from './test-support/clock.js';

test('delivery batches carry one verified entry per emitted sender, with exact byte accounting and no self-chat metadata', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const peer = '@agent-holmes:test.localhost', foreign = '@agent-foreign:test.localhost', unknown = '@agent-lookalike:remote.test';
  fixture.identities.set(foreign, { backendUserId: foreign, kind: 'agent', ownerBackendUserId: '@other:test.localhost', displayName: null, ownerDisplayName: null });
  const events = [message('$self', SELF), message('$owner', OBSERVER), message('$peer', peer), message('$foreign', foreign),
    message('$unknown', unknown), message('$again', peer)].map(event => eventView(messageEvent(event, ROOM), ROOM));
  const identities = await resolveSenders(fixture.coordination, events.slice(1), new AbortController().signal);
  const artifacts = messageArtifacts(localState, fixture.cursorFile + '.messages', Date.now);
  const batches = chatBatches(deliveryEvents(events, SELF), fixture.settings, identities, 65536, 'shared', artifacts);
  assert.equal(batches.length, 1);
  const data = JSON.parse(batches[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { [OBSERVER]: { kind: 'human', displayName: null, relationship: 'owner' },
    [peer]: { kind: 'agent', owner: OBSERVER, displayName: null, ownerDisplayName: null, relationship: 'owners-agent' },
    [foreign]: { kind: 'agent', owner: '@other:test.localhost', displayName: null, ownerDisplayName: null, relationship: 'other-owners-agent' },
    [unknown]: { kind: 'unknown', displayName: null, relationship: 'unknown' } });
  assert.deepEqual(data.events.map((event: { eventId: string }) => event.eventId), ['$owner', '$peer', '$foreign', '$unknown', '$again']);
  assert.equal(fixture.requests.filter(request => request.path === '/api/principal-resolutions').length, 1);
  const large = Array.from({ length: 3 }, (_, index) => eventView(messageEvent(message('$large-' + index, index === 0 ? OBSERVER : peer, 'x'.repeat(500)), ROOM), ROOM));
  const divided = chatBatches(large, fixture.settings, identities, 2200, 'shared', artifacts);
  assert.equal(divided.length, 1);
  for (const batch of divided) {
    assert(Buffer.byteLength(batch.text) <= 2200);
    const pointer = JSON.parse(batch.text.split('\n').slice(1).join('\n'));
    const manifest = JSON.parse(readFileSync(pointer.manifest, 'utf8'));
    const value = { ...manifest.metadata, events: manifest.messages.map((entry: { file: string }) => JSON.parse(readFileSync(entry.file, 'utf8'))) };
    assert.deepEqual(Object.keys(value.senders).sort(), [...new Set(value.events.map((event: { sender: string }) => event.sender))].sort());
  }
  assert.throws(() => chatBatches(deliveryEvents(events, SELF), fixture.settings, new Map(), 65536, 'shared', artifacts), /Missing verified sender identity/);
});

test('sender resolution rejects partial, substituted, duplicate and inconsistent metadata without inferred ownership', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const events = [eventView(messageEvent(message('$owner', OBSERVER), ROOM), ROOM)];
  const invalid: PrincipalIdentity[][] = [[], [{ backendUserId: '@other:test.localhost', kind: 'human', ownerBackendUserId: null, displayName: null, ownerDisplayName: null }],
    [{ backendUserId: OBSERVER, kind: 'human', ownerBackendUserId: OBSERVER, displayName: null, ownerDisplayName: null }],
    [{ backendUserId: OBSERVER, kind: 'human', ownerBackendUserId: null, displayName: null, ownerDisplayName: null }, { backendUserId: OBSERVER, kind: 'human', ownerBackendUserId: null, displayName: null, ownerDisplayName: null }]];
  for (const response of invalid) {
    await assert.rejects(resolveSenders({ ...fixture.coordination, identities: async () => success(response) }, events, new AbortController().signal));
  }
  assert.equal(fixture.requests.length, 0);
});

test('listener metadata failures never reach the model or advance unread room positions', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory);
  fixture.add(ROOM, message('$unread', OBSERVER));
  fixture.failures.set('/api/principal-resolutions', [503]);
  await assert.rejects(listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: native.runtime }, new AbortController().signal));
  const cursors = existsSync(fixture.cursorFile) ? JSON.parse(readFileSync(fixture.cursorFile, 'utf8')) : {};
  assert(!cursors[ROOM] || cursors[ROOM] === '0');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
});

test('sender resolution retains its exact request while the independent receiver continues polling', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory), stop = new AbortController();
  fixture.add(ROOM, message('$owner', OBSERVER));
  const pending = fixture.hold('/api/principal-resolutions');
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); pending.release(); await receiving; });
  await until(pending.entered);
  await until(() => fixture.requests.filter(request => request.path.endsWith('/sync')).length >= 3);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  pending.release();
  await until(() => native.requests().some(request => request.method === 'turn/start'));
  const input = native.requests().find(request => request.method === 'turn/start')!.params!.input as { text: string }[];
  const data = JSON.parse(input[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { [OBSERVER]: { kind: 'human', displayName: null, relationship: 'owner' } });
});

test('idle and blocked traffic perform no sender lookups; authorized delivery includes buffered verified ownership', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  fixture.waking.policy = 'selected'; fixture.waking.senders = [OBSERVER];
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await clock.observe(() => fixture.waiting() === 1);
  const syncs = fixture.requests.filter(request => request.path.endsWith('/sync')).length;
  fixture.add(ROOM, message('$peer', '@agent-holmes:test.localhost', 'Buffered peer context'));
  await clock.observe(() => fixture.requests.filter(request => request.path.endsWith('/sync')).length >= syncs + 1 && fixture.waiting() === 1);
  await clock.advance(100);
  await clock.observe(() => fixture.requests.filter(request => request.path.endsWith('/sync')).length >= syncs + 2 && fixture.waiting() === 1);
  assert.equal(fixture.requests.filter(request => request.path === '/api/principal-resolutions').length, 0);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  fixture.add(ROOM, message('$owner', OBSERVER, 'One authorized task'));
  await clock.observe(() => native.requests().some(request => request.method === 'turn/start'));
  const input = native.requests().find(request => request.method === 'turn/start')!.params!.input as { text: string }[];
  const data = JSON.parse(input[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { '@agent-holmes:test.localhost': { kind: 'agent', owner: OBSERVER, displayName: null, ownerDisplayName: null, relationship: 'owners-agent' },
    [OBSERVER]: { kind: 'human', displayName: null, relationship: 'owner' } });
  assert.deepEqual(data.events.map((event: { eventId: string }) => event.eventId), ['$peer', '$owner']);
  const resolutions = fixture.requests.filter(request => request.path === '/api/principal-resolutions');
  assert.equal(resolutions.length, 1, JSON.stringify(resolutions.map(request => request.body)));
}));
