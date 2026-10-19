import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Release } from '@ctlflow/crossfire-adapter-filesystem/release';
import { nativeApplication } from './native-application.js';
import { createHttpServer } from '../../apps/server/src/http/create-server.js';
import { createWorker } from '../../apps/server/src/worker.js';
import { publicRouter } from '../../apps/server/src/router.js';
import type { ElementPresentation } from '@ctlflow/crossfire-adapter-matrix/web/element-configuration';
import { matrixPublicRoutes } from '@ctlflow/crossfire-adapter-matrix/web/router';
import { secureRouter } from '@ctlflow/crossfire-test-support/tls';
export async function nativeServer(scope: TestContext, release: Release, presentation: ElementPresentation = {}, element?: string) {
  const fixture = await nativeApplication(scope), worker = createWorker(fixture.services, fixture.application.diagnostics);
  const server = createHttpServer(fixture.application, worker, release, presentation);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const routes = { publicOrigin: fixture.application.config.publicOrigin, matrixOrigin: fixture.native.base,
    service: server, web: join(process.cwd(), 'dist/web'), element: element ?? join(process.cwd(), 'dist/web') };
  cleanup(scope, async () => { await worker.stop(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); });
  const publicRoutes = { publicOrigin: routes.publicOrigin, service: server, web: routes.web, backend: matrixPublicRoutes(routes) };
  const { server: router, origin } = await secureRouter(scope, publicRouter(publicRoutes));
  publicRoutes.publicOrigin = origin; routes.publicOrigin = origin; fixture.application.config.publicOrigin = origin; fixture.services.instance.publicOrigin = origin;
  return { ...fixture, origin, worker, router, server };
}
