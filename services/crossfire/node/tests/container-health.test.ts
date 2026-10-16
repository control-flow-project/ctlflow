import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { verifyContainerHealth } from '../apps/server/src/container-health.js';

test('native loopback probes retain the configured public Host and reject redirects or unavailable Matrix', async () => {
  const host = 'verification.localhost:55000', requests: string[] = [], hosts: string[] = []; let status = 200;
  const server = createServer((request, response) => {
    hosts.push(request.headers.host ?? '');
    requests.push(request.url!);
    response.statusCode = request.headers.host !== host || request.method !== 'GET' ? 421 : request.url === '/_matrix/client/versions' ? status : 200;
    if (status === 302) response.setHeader('Location', '/must-not-be-followed');
    response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert(address && typeof address !== 'string');
    await verifyContainerHealth(host, address.port);
    assert.deepEqual(requests, ['/api/health', '/_matrix/client/versions']);
    assert.deepEqual(hosts, [host, host]);
    for (const code of [302, 503]) {
      status = code; requests.length = 0;
      await assert.rejects(verifyContainerHealth(host, address.port), new RegExp('/_matrix/client/versions returned ' + code));
      assert.deepEqual(requests, ['/api/health', '/_matrix/client/versions']);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
