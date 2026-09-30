import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Release } from '@crossfire/adapter-filesystem/release';
import { nativeApplication } from './native-application.js';
import { createHttpServer } from '../../apps/server/src/http/create-server.js';
import { createWorker } from '../../apps/server/src/worker.js';
import { publicRouter } from '../../apps/server/src/router.js';
import type { ElementPresentation } from '../../apps/server/src/element-configuration.js';
export async function nativeServer(scope: TestContext, release: Release, presentation: ElementPresentation = {}) {
  const fixture = await nativeApplication(scope), worker = createWorker(fixture.services);
  const server = createHttpServer(fixture.application, worker, release, presentation);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const routes = { publicOrigin: fixture.application.config.publicOrigin, matrixOrigin: fixture.native.base,
    serviceOrigin: 'http://127.0.0.1:' + address.port, web: join(process.cwd(), 'dist/web'), element: join(process.cwd(), 'dist/web') };
  const router = publicRouter(routes);
  router.listen(0, '127.0.0.1'); await once(router, 'listening');
  const publicAddress = router.address(); assert(publicAddress && typeof publicAddress !== 'string');
  const origin = 'http://127.0.0.1:' + publicAddress.port;
  routes.publicOrigin = origin; fixture.application.config.publicOrigin = origin; fixture.services.instance.publicOrigin = origin;
  scope.after(async () => { await worker.stop(); router.closeAllConnections(); server.closeAllConnections();
    await new Promise<void>(resolve => router.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { ...fixture, origin, worker, router, server };
}
