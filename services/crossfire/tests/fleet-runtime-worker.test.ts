import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createFleetControlConnection } from '@ctlflow/crossfire-adapter-crossfire/fleet-control';
import { createFleetRuntimeWorker } from '@ctlflow/crossfire-adapter-crossfire/fleet-runtime';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { until } from '../scripts/test-support/listener.js';
import type { FleetRuntimeOperation } from '@ctlflow/crossfire-contracts/fleet-runtime';

function command(): FleetRuntimeOperation {
  return { operationId: randomUUID(), fleetId: randomUUID(), agentId: null, action: 'reset', expectedRevision: 0,
    status: 'pending', createdAt: 1, completedAt: null, errorMessage: null };
}
function response(data: unknown): Response { return Response.json({ data, meta: { requestId: randomUUID() } }); }

test('a final reclaimed outcome acknowledges the local pin without executing native work or sending another receipt', async () => {
  for (const status of ['succeeded', 'failed'] as const) {
    const operation = command(), failures: string[] = [];
    let executions = 0, claims = 0, acknowledged = 0, failAcknowledgement = true;
    const client = createClient({ origin: 'http://127.0.0.1', fetch: async url => {
      assert(String(url).endsWith('/claim'), 'No second receipt is needed for a persisted final outcome'); claims++;
      return response({ ...operation, status, completedAt: 2, errorMessage: status === 'failed' ? 'Native operation failed' : null });
    } });
    const worker = createFleetRuntimeWorker({ client, fleetId: operation.fleetId, connection: () => ({ connected: true, id: randomUUID() }),
      fail: message => { failures.push(message); }, execute: async () => { executions++; return success({ status: 'succeeded', errorMessage: null }); },
      acknowledged: () => { acknowledged++; return failAcknowledgement ? failure('unavailable', 'Cannot persist local acknowledgement') : success(undefined); } });
    worker.receive(operation); await worker.close();
    assert.deepEqual(failures, ['Cannot persist local acknowledgement']);
    failAcknowledgement = false; worker.receive(operation); await worker.close();
    assert.equal(executions, 0); assert.equal(claims, 2); assert.equal(acknowledged, 2);
  }
});

test('uncertain receipts reclaim the same command identity after reconnect without a second destructive native operation', async () => {
  const operation = command(), generations: string[] = [], failures: string[] = [];
  let generation = randomUUID(), calls = 0, nativeResets = 0, acknowledgements = 0, loseReceipt = true;
  const results = new Map<string, { status: 'succeeded'; errorMessage: null }>();
  const client = createClient({ origin: 'http://127.0.0.1', fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { connectionId: string; status?: string };
    assert.equal(body.connectionId, generation);
    if (String(url).endsWith('/claim')) { generations.push(body.connectionId); return response({ ...operation, status: 'running' }); }
    if (loseReceipt) { loseReceipt = false; throw new Error('Native result was saved, but remote receipt was lost'); }
    return response({ ...operation, status: 'succeeded', completedAt: 2 });
  } });
  const worker = createFleetRuntimeWorker({ client, fleetId: operation.fleetId, connection: () => ({ connected: true, id: generation }),
    fail: message => { failures.push(message); }, acknowledged: () => { acknowledgements++; return success(undefined); },
    execute: async incoming => {
      calls++; let result = results.get(incoming.operationId);
      if (!result) { nativeResets++; result = { status: 'succeeded', errorMessage: null }; results.set(incoming.operationId, result); }
      return success(result);
    } });
  worker.receive(operation); await worker.close();
  assert.equal(failures.length, 1); assert.equal(nativeResets, 1); assert.equal(acknowledgements, 0);
  generation = randomUUID(); worker.receive(operation); await worker.close();
  assert.equal(calls, 2); assert.equal(nativeResets, 1); assert.equal(acknowledgements, 1);
  assert.equal(generations.length, 2); assert.notEqual(generations[0], generations[1]);
});

test('slow native lifecycle operations do not block controller polling, lease renewal or delivery liveness', async scope => {
  const operation = command(), failures: unknown[] = []; let claims = 0, polls = 0, renewals = 0, executions = 0, finished = false;
  let release!: () => void;
  const native = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (request, reply) => {
    try {
      const url = new URL(request.url!, 'http://127.0.0.1');
      const view = { fleetId: operation.fleetId, revision: 1, deliveryEnabled: true, connection: { status: 'online', lastSeenAt: Date.now() } };
      let data: unknown;
      if (url.pathname.endsWith('/claim')) { claims++; data = { ...operation, status: 'running' }; }
      else if (url.pathname.endsWith('/receipt')) { finished = true; data = { ...operation, status: 'succeeded', completedAt: 2 }; }
      else if (request.method === 'PUT') { renewals++; data = view; }
      else { polls++; data = { ...view, agentIds: [], messages: [], runtimeOperations: finished ? [] : [operation] }; }
      request.resume(); reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify({ data, meta: { requestId: randomUUID() } }));
    } catch (error) { failures.push(error); reply.destroy(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const control = createFleetControlConnection({ origin: 'http://127.0.0.1:' + address.port, credential: 'private-fixture', owner: '@owner:test',
    fleetId: operation.fleetId, signal: new AbortController().signal, acknowledged: () => success(undefined),
    execute: async () => { executions++; await native; return success({ status: 'succeeded', errorMessage: null }); } });
  cleanup(scope, async () => { release(); await control.close(); });
  await until(() => polls >= 3, 'Slow lifecycle work must not block the control-plane loop');
  assert.equal(executions, 1); assert.equal(claims, 1); assert(renewals >= 3); assert.equal(control.status().connected, true);
  release(); await until(() => finished); assert.deepEqual(failures, []);
});

test('a rejected controller command retains its root cause when cancellation interrupts the control loop', async scope => {
  const operation = command(), message = 'Controller claim rejected by owner authority'; let executions = 0;
  const server = createServer((request, reply) => {
    request.resume();
    const meta = { requestId: randomUUID() };
    if (request.url?.endsWith('/claim')) {
      reply.writeHead(409, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify({ error: { code: 'conflict', message }, meta })); return;
    }
    const view = { fleetId: operation.fleetId, revision: 1, deliveryEnabled: true, connection: { status: 'online', lastSeenAt: Date.now() } };
    reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify({ meta,
      data: request.method === 'PUT' ? view : { ...view, agentIds: [], messages: [], runtimeOperations: [operation] } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const control = createFleetControlConnection({ origin: 'http://127.0.0.1:' + address.port, credential: 'private-fixture', owner: '@owner:test',
    fleetId: operation.fleetId, signal: new AbortController().signal, acknowledged: () => success(undefined),
    execute: async () => { executions++; return success({ status: 'succeeded', errorMessage: null }); } });
  cleanup(scope, () => control.close());
  await until(() => control.status().error === message);
  await control.close(); assert.equal(control.status().error, message); assert.equal(control.status().connected, false); assert.equal(executions, 0);
});
