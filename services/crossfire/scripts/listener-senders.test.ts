import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { deliveryBatches } from '@crossfire/agent-core/listen';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { eventView } from '@crossfire/agent-core/receive';
import { resolveSenders } from '@crossfire/agent-core/senders';
import { success } from '@crossfire/kernel/result';
import type { PrincipalIdentity } from '@crossfire/contracts/schema/response';
import { fakeCodex, matrixFixture, message, OBSERVER, ROOM, SELF, temporary, until } from './test-support/listener.js';

test('delivery batches carry one verified entry per emitted sender, with exact byte accounting and no self-chat metadata', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const peer = '@agent-holmes:test.localhost', foreign = '@agent-foreign:test.localhost', unknown = '@agent-lookalike:remote.test';
  fixture.identities.set(foreign, { matrixUserId: foreign, kind: 'agent', ownerMatrixId: '@other:test.localhost' });
  const events = [message('$self', SELF), message('$owner', OBSERVER), message('$peer', peer), message('$foreign', foreign),
    message('$unknown', unknown), message('$again', peer)].map(event => eventView(event, ROOM));
  const identities = await resolveSenders(fixture.coordination, events.slice(1), new AbortController().signal);
  const batches = deliveryBatches(events, fixture.settings, SELF, identities);
  assert.equal(batches.length, 1);
  const data = JSON.parse(batches[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { [OBSERVER]: { kind: 'human' }, [peer]: { kind: 'agent', owner: OBSERVER },
    [foreign]: { kind: 'agent', owner: '@other:test.localhost' }, [unknown]: { kind: 'unknown' } });
  assert.deepEqual(data.events.map((event: { event_id: string }) => event.event_id), ['$owner', '$peer', '$foreign', '$unknown', '$again']);
  assert.equal(fixture.requests.filter(request => request.path === '/api/principal-resolutions').length, 1);
  const large = Array.from({ length: 3 }, (_, index) => eventView(message('$large-' + index, index === 0 ? OBSERVER : peer, 'x'.repeat(500)), ROOM));
  const divided = deliveryBatches(large, fixture.settings, SELF, identities, 1400);
  assert(divided.length > 1);
  for (const batch of divided) {
    assert(Buffer.byteLength(batch.text) <= 1400);
    const value = JSON.parse(batch.text.split('\n').slice(1).join('\n'));
    assert.deepEqual(Object.keys(value.senders).sort(), [...new Set(value.events.map((event: { sender: string }) => event.sender))].sort());
  }
  assert.throws(() => deliveryBatches(events, fixture.settings, SELF, new Map()), /Missing verified sender identity/);
});

test('sender resolution rejects partial, substituted, duplicate and inconsistent metadata without inferred ownership', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const events = [eventView(message('$owner', OBSERVER), ROOM)];
  const invalid: PrincipalIdentity[][] = [[], [{ matrixUserId: '@other:test.localhost', kind: 'human', ownerMatrixId: null }],
    [{ matrixUserId: OBSERVER, kind: 'human', ownerMatrixId: OBSERVER }],
    [{ matrixUserId: OBSERVER, kind: 'human', ownerMatrixId: null }, { matrixUserId: OBSERVER, kind: 'human', ownerMatrixId: null }]];
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
  scope.after(async () => { stop.abort(); pending.release(); await receiving; });
  await until(pending.entered);
  await until(() => fixture.requests.filter(request => request.path.endsWith('/sync')).length >= 3);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  pending.release();
  await until(() => native.requests().some(request => request.method === 'turn/start'));
  const input = native.requests().find(request => request.method === 'turn/start')!.params!.input as { text: string }[];
  const data = JSON.parse(input[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { [OBSERVER]: { kind: 'human' } });
});

test('idle and blocked traffic perform no sender lookups; authorized delivery includes buffered verified ownership', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory), stop = new AbortController();
  fixture.waking.policy = 'owner'; fixture.waking.senders = [OBSERVER];
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  scope.after(async () => { stop.abort(); await receiving; });
  await until(() => fixture.waiting() === 1);
  fixture.add(ROOM, message('$peer', '@agent-holmes:test.localhost', 'Buffered peer context'));
  await until(() => fixture.requests.filter(request => request.path.endsWith('/sync')).length >= 3);
  assert.equal(fixture.requests.filter(request => request.path === '/api/principal-resolutions').length, 0);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  fixture.add(ROOM, message('$owner', OBSERVER, 'One authorized task'));
  await until(() => native.requests().some(request => request.method === 'turn/start'));
  const input = native.requests().find(request => request.method === 'turn/start')!.params!.input as { text: string }[];
  const data = JSON.parse(input[0]!.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(data.senders, { '@agent-holmes:test.localhost': { kind: 'agent', owner: OBSERVER }, [OBSERVER]: { kind: 'human' } });
  assert.deepEqual(data.events.map((event: { event_id: string }) => event.event_id), ['$peer', '$owner']);
  assert.equal(fixture.requests.filter(request => request.path === '/api/principal-resolutions').length, 1);
});
