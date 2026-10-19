import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest, type Server, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { forwardMatrix } from '@ctlflow/crossfire-adapter-matrix/web/proxy';
import { secureRouter } from '@ctlflow/crossfire-test-support/tls';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';

async function listen(scope: Parameters<typeof cleanup>[0], server: Server, host = '127.0.0.1'): Promise<string> {
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  server.listen(0, host); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string'); return 'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' + address.port;
}

for (const { secure, host } of [{ secure: false, host: '127.0.0.1' }, { secure: true, host: '127.0.0.1' }, { secure: false, host: '::1' }]) test('Matrix forwarding isolates cookies and hop headers over ' + (secure ? 'HTTPS' : 'HTTP') + ' ' + host, async scope => {
  let received: IncomingHttpHeaders = {};
  const backend = createServer((request, response) => {
    received = request.headers;
    const status = request.url === '/redirect' ? 302 : request.url === '/unchanged' ? 304 : 200;
    response.writeHead(status, { 'Set-Cookie': 'backend-secret=value', Connection: 'x-private', 'X-Private': 'hidden', 'X-Result': 'visible', Location: 'https://outside.invalid/' });
    request.resume(); response.end(status === 200 ? 'native-response' : undefined);
  });
  const origin = secure ? (await secureRouter(scope, backend)).origin : await listen(scope, backend, host);
  const frontend = await listen(scope, createServer((request, response) => forwardMatrix(request, response, origin, 'https://chat.example.test')));
  const response = await new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const request = httpRequest(frontend + '/native', { headers: { Cookie: 'crossfire-session=private', 'Set-Cookie': 'untrusted=value', Authorization: 'Bearer native-token',
      Connection: 'x-private', 'X-Private': 'hidden', Forwarded: 'for=spoofed', 'X-Forwarded-Proto': 'http' } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, text })); response.on('error', reject);
    }); request.on('error', reject); request.end();
  });
  assert.equal(response.status, 200); assert.equal(response.text, 'native-response'); assert.equal(received.host, 'chat.example.test');
  assert.equal(received.authorization, 'Bearer native-token');
  for (const name of ['cookie', 'set-cookie', 'x-private', 'forwarded', 'x-forwarded-proto']) assert.equal(received[name], undefined, name);
  assert.equal(response.headers['set-cookie'], undefined); assert.equal(response.headers['x-private'], undefined); assert.equal(response.headers['x-result'], 'visible');
  assert.equal((await fetch(frontend + '/redirect', { redirect: 'manual' })).status, 502);
  assert.equal((await fetch(frontend + '/unchanged')).status, 304);
});
