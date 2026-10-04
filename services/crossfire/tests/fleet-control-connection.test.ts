import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { operations } from '@crossfire/contracts/rest/operations';
import { createFleetControlConnection } from '@crossfire/adapter-crossfire/fleet-control';
import { until } from '../scripts/test-support/listener.js';
import { success } from '@crossfire/kernel/result';

test('controller retains uncertain acquisition ownership and closes that exact generation before reconnecting', async scope => {
  const fleetId = randomUUID(), agentId = randomUUID(), stop = new AbortController();
  let lease: string | null = null, lost: string | undefined, offline = false;
  const acquired: string[] = [], released: string[] = [], errors: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (offline) { response.destroy(); return; }
      assert.equal(request.headers.authorization, 'Bearer private-fixture');
      const url = new URL(request.url!, 'http://127.0.0.1');
      const meta = { requestId: randomUUID() };
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const parsed = operations.reportFleetConnection.input(JSON.parse(Buffer.concat(chunks).toString()));
        const params = operations.reportFleetConnection.params({ fleetId, connectionId: url.pathname.split('/').at(-1)! });
        assert(parsed.ok && params.ok);
        const id = params.value.connectionId;
        if (parsed.value.stopped) {
          assert.equal(id, lease, 'Cleanup cannot target a different native generation');
          released.push(id); lease = null;
        } else {
          if (lease !== null && lease !== id) {
            response.writeHead(409, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { code: 'conflict', message: 'Another live controller owns this fleet connection' }, meta }));
            return;
          }
          lease = id;
          if (!acquired.includes(id)) acquired.push(id);
          if (!lost) { lost = id; response.destroy(); return; }
        }
      } else {
        assert.equal(url.pathname, '/api/fleets/' + fleetId + '/control');
        assert.equal(url.searchParams.get('connectionId'), lease);
      }
      const view = { fleetId, revision: 0, deliveryEnabled: true, connection: { status: 'online', lastSeenAt: Date.now() } };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: request.method === 'PUT' ? view : { ...view, agentIds: [agentId], messages: [], runtimeOperations: [] }, meta }));
    } catch (error) { errors.push(error); response.destroy(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const control = createFleetControlConnection({ origin: 'http://127.0.0.1:' + address.port, credential: 'private-fixture',
    fleetId, owner: '@owner:fixture.localhost', signal: stop.signal, execute: async () => success({ status: 'succeeded', errorMessage: null }), acknowledged: () => success(undefined) });
  cleanup(scope, () => control.close());
  const listener = control.listener(agentId);
  await until(() => listener.control.current().active, 'Unknown native acquisition blocked its own reconnect');
  assert.equal(acquired.length, 2);
  assert.notEqual(acquired[1], lost);
  assert.deepEqual(released, [lost]);
  await control.close();
  assert.equal(lease, null);
  assert.deepEqual(released, acquired);
  const disconnected = createFleetControlConnection({ origin: 'http://127.0.0.1:' + address.port, credential: 'private-fixture',
    fleetId, owner: '@owner:fixture.localhost', signal: stop.signal, execute: async () => success({ status: 'succeeded', errorMessage: null }), acknowledged: () => success(undefined) });
  cleanup(scope, () => disconnected.close());
  const stopping = disconnected.listener(agentId);
  await until(() => stopping.control.current().active);
  offline = true;
  await disconnected.close();
  assert.equal(stopping.control.current().active, false, 'Local shutdown cannot require an available Crossfire server');
  assert.equal(disconnected.status().connected, false);
  assert.equal(lease, acquired[2], 'Failed remote cleanup is not represented as confirmed native release');
  assert.deepEqual(errors, []);
});
