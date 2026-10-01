import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { readFleetDirectory } from '../apps/web/src/fleet-directory/read.js';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';

test('fleet directory composes bounded canonical pages, retains filters and does not hide failures', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture;
  const other = await fixture.member('alice');
  for (let index = 0; index < 103; index++) value(services.repositories.fleet.insert({ id: randomUUID(), ownerId: admin.actor.principalId,
    fleetKey: 'fleet-' + String(index).padStart(3, '0'), label: 'Fleet ' + index, controllerName: 'Workstation', deliveryEnabled: true, revision: 0, createdAt: fixture.now(), updatedAt: fixture.now() }));
  value(services.repositories.fleet.insert({ id: randomUUID(), ownerId: other.actor.principalId, fleetKey: 'private', label: 'Private fleet',
    controllerName: 'Other computer', deliveryEnabled: true, revision: 0, createdAt: fixture.now(), updatedAt: fixture.now() }));
  const { origin } = await httpFixture(scope, fixture.application), requests: URL[] = [];
  const client = (cookie: string, failPage?: number) => createClient({ origin, fetch: async (input, options) => {
    const url = new URL(String(input)); requests.push(url);
    if (url.searchParams.get('page') === String(failPage)) return new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Fixture page unavailable' }, meta: { requestId: randomUUID() } }), { status: 503 });
    return fetch(input, { ...options, headers: { ...options?.headers, Cookie: 'crossfire=' + cookie } });
  } });
  const all = value(await readFleetDirectory(client(admin.secret), 'ownerId=' + admin.actor.principalId + '&page=4&pageSize=10&search=workstation'));
  assert.equal(all.length, 103); assert.equal(new Set(all.map(fleet => fleet.fleetId)).size, 103);
  assert.equal(requests.length, 2);
  for (const url of requests) { assert.equal(url.searchParams.get('pageSize'), '100'); assert.equal(url.searchParams.get('ownerId'), admin.actor.principalId); assert.equal(url.searchParams.get('search'), 'workstation'); }
  assert.deepEqual(requests.map(url => url.searchParams.get('page')), ['1', '2']);
  const member = value(await readFleetDirectory(client(other.secret), ''));
  assert.deepEqual(member.map(fleet => fleet.label), ['Private fleet']);
  const failure = await readFleetDirectory(client(admin.secret, 2), '');
  assert.equal(failure.ok, false); if (!failure.ok) assert.equal(failure.error.message, 'Fixture page unavailable');
  const denied = await readFleetDirectory(client(other.secret), 'ownerId=' + admin.actor.principalId);
  assert.equal(denied.ok, false);
  const stop = new AbortController(); let attempted = 0;
  const cancelled = createClient({ origin, signal: stop.signal, fetch: async (_input, options) => {
    attempted++; stop.abort(); options!.signal!.throwIfAborted(); throw new Error('No request after cancellation');
  } });
  assert.equal((await readFleetDirectory(cancelled, '')).ok, false); assert.equal(attempted, 1);
});
