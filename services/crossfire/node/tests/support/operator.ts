import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
import { applicationFixture } from './application.js';
import { httpFixture } from './http.js';
import { contractRelease } from './release.js';
import { randomUUID } from 'node:crypto';

export async function operatorFixture(scope: TestContext) {
  const fixture = await applicationFixture(scope), release = contractRelease(), backend = await httpFixture(scope, fixture.application, release);
  const requests: { method: string; path: string }[] = [];
  let failAgents = false, wrongAccount = false;
  const listeners = backend.server.listeners('request');
  backend.server.removeAllListeners('request');
  backend.server.on('request', (request: IncomingMessage, response: ServerResponse) => { void (async () => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    requests.push({ method: request.method!, path });
    const reply = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (path === '/api/backend-authentication') {
      reply(200, { data: { accessToken: wrongAccount ? 'unknown-account-token' : fixture.admin.token }, meta: { requestId: randomUUID() } }); return;
    }
    if (path === '/_matrix/client/v3/logout') { reply(200, {}); return; }
    if (path === '/_matrix/client/v3/joined_rooms') { reply(200, { joined_rooms: [] }); return; }
    if (path === '/_matrix/client/v3/user_directory/search') {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      reply(200, { limited: false, results: [...fixture.native.accounts].filter(([id]) => id.includes(String(body.search_term))).map(([user_id, account]) => ({ user_id, display_name: account.displayName })) }); return;
    }
    if (failAgents && path === '/api/agents') { reply(503, { error: { code: 'native', message: 'PRIVATE_TOKEN_' + fixture.admin.token }, meta: { requestId: randomUUID() } }); return; }
    for (const listener of listeners) listener.call(backend.server, request, response);
  })().catch(() => { response.writeHead(500); response.end(); }); });
  return { ...fixture, server: backend.server, origin: backend.origin, release, requests, account: { backendUserId: fixture.application.config.administrator, password: 'fixture-only' },
    failAgents() { failAgents = true; }, wrongAccount() { wrongAccount = true; } };
}
