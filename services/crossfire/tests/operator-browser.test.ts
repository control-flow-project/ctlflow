import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@crossfire/test-support/cleanup';
import { publicRouter } from '../apps/server/src/router.js';
import { verifyBrowser } from '../tools/browser/verify.js';
import { operatorFixture } from './support/operator.js';
import { value } from './support/application.js';
import { secureRouter, browserExecutable } from './support/tls.js';

test('operator browser waits for authenticated management, checks real views and logs out both sessions', { timeout: 120000 }, async scope => {
  const fixture = await operatorFixture(scope);
  await fixture.agent(fixture.admin.actor, 'helper');
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-operator-browser-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const routes = { publicOrigin: 'http://127.0.0.1', matrixOrigin: fixture.origin, serviceOrigin: fixture.origin,
    web: join(process.cwd(), 'dist/web'), element: join(process.cwd(), 'dist/web') };
  const { origin } = await secureRouter(scope, publicRouter(routes));
  routes.publicOrigin = origin;
  fixture.application.config.publicOrigin = origin;
  fixture.services.instance.publicOrigin = origin;
  const report = value(await verifyBrowser(origin, fixture.account, browserExecutable(scope), directory, new AbortController().signal));
  assert.equal(report.human, fixture.account.matrixUserId);
  assert.equal(report.managementRoutes, 38);
  assert.equal(report.modelCalls, 0);
  assert.equal(fixture.requests.filter(request => request.method === 'DELETE' && request.path === '/api/sessions/current').length, 2);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/logout')).length, 2);
  assert.equal(fixture.native.rooms.size, 0);
});
