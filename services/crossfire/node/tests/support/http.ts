import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { TestContext } from 'node:test';
import { createHttpServer } from '../../apps/server/src/http/create-server.js';
import type { Application } from '../../apps/server/src/composition.js';
import type { Release } from '@ctlflow/crossfire-adapter-filesystem/release';
import { contractRelease } from './release.js';
export async function httpFixture(scope: TestContext, application: Application, release: Release = contractRelease(), worker = { wake() {}, drain: async () => {}, stop: async () => {} }) {
  const server = createHttpServer(application, worker, release);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  application.config.publicOrigin = origin; application.services.instance.publicOrigin = origin;
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  function headers(session: { secret: string; csrfSecret: string }) { return { Cookie: '__Host-crossfire=' + session.secret, Origin: origin, 'X-Crossfire-CSRF': session.csrfSecret }; }
  async function request(path: string, method = 'GET', input?: unknown, headers: Record<string, string> = {}) {
    return fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(15_000) });
  }
  return { server, origin, request, headers };
}
