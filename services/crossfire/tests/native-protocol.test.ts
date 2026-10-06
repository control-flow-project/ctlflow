import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import { WebSocketServer } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { codexProtocol, type NativeRequest } from '@ctlflow/crossfire-adapter-codex/protocol';

async function fixture(scope: TestContext, mode: string, approval = async (_request: NativeRequest, _signal: AbortSignal): Promise<unknown> => {
  throw new Error('Unexpected approval request');
}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (info: { req: import('node:http').IncomingMessage }) => info.req.headers.authorization === 'Bearer fixture' });
  await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address === 'object');
  server.on('connection', socket => {
    let pending: unknown;
    socket.on('message', data => {
      const input = JSON.parse(data.toString()) as { id: number | string; method?: string; result?: unknown };
      if (!input.method) { socket.send(JSON.stringify({ id: pending, result: input.result })); return; }
      const response = JSON.stringify({ id: input.id, result: { text: 'é🐝', method: input.method } });
      if (mode === 'overflow') socket.send('x'.repeat(8 * 1024 * 1024 + 1));
      else if (mode === 'utf8') socket.send(Buffer.from([255]), { binary: false });
      else if (mode === 'binary') socket.send(Buffer.from(response));
      else if (mode === 'truncated') socket.send('{');
      else if (mode === 'malformed-error') socket.send(JSON.stringify({ id: input.id, error: null }));
      else if (mode === 'unknown') socket.send(JSON.stringify({ id: -1, result: {} }));
      else if (mode === 'approval') { pending = input.id; socket.send(JSON.stringify({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture' } })); }
      else if (mode === 'split') { socket.send(response.slice(0, 4), { fin: false }); socket.send(response.slice(4), { fin: true }); }
      else { socket.send(response); if (mode === 'duplicate') socket.send(response); }
    });
  });
  const stop = new AbortController();
  const engine = codexProtocol({ endpoint: 'ws://127.0.0.1:' + address.port, token: 'fixture', timeoutMs: 1000, event: () => {}, approval }, stop.signal);
  cleanup(scope, async () => { stop.abort(); await engine.closed; });
  return engine;
}

test('native WS framing preserves fragmented UTF-8 and exact responses', async scope => {
  for (const mode of ['normal', 'split']) {
    const engine = await fixture(scope, mode);
    assert.deepEqual(await engine.request('first', {}), { text: 'é🐝', method: 'first' });
    assert.deepEqual(await engine.request('second', {}), { text: 'é🐝', method: 'second' });
    engine.close(); await engine.closed;
  }
});

test('native WS framing rejects oversized, invalid, duplicate and truncated frames', async scope => {
  for (const mode of ['overflow', 'utf8', 'binary', 'truncated', 'malformed-error', 'unknown', 'duplicate']) {
    const engine = await fixture(scope, mode);
    const aborted = once(engine.signal, 'abort');
    const result = engine.request('test', {}).catch(error => error);
    await aborted;
    const value = await result;
    if (mode !== 'duplicate') assert(value instanceof Error, mode);
    assert.equal(engine.signal.aborted, true);
    assert(await engine.request('again', {}).catch(error => error) instanceof Error);
    await engine.closed;
  }
});

test('native approval responses wait for the explicit bound human decision', async scope => {
  let received: NativeRequest | undefined;
  let decide!: (value: unknown) => void;
  const engine = await fixture(scope, 'approval', (request, signal) => {
    received = request;
    return new Promise(resolve => { decide = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
  });
  let resolved = false;
  const request = engine.request('test', {}).then(value => { resolved = true; return value; });
  const deadline = performance.now() + 5000;
  while (!received) { assert(performance.now() < deadline, 'Native approval did not arrive'); await delay(5); }
  assert.equal(resolved, false, 'The observed native approval remains held by the explicit decision promise');
  assert.deepEqual(received, { id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'fixture' } });
  decide({ decision: 'decline' });
  assert.deepEqual(await request, { decision: 'decline' });
});
