import { matrixPublicRoutes } from '@ctlflow/crossfire-adapter-matrix/web/router';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as send, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { publicRouter } from '../apps/server/src/router.js';

async function fixture(scope: TestContext) {
  const scratch = join(process.cwd(), '.temp');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, 'router-'));
  const element = join(directory, 'element');
  const web = join(directory, 'web');
  mkdirSync(join(element, 'usercontent'), { recursive: true });
  mkdirSync(web);
  writeFileSync(join(element, 'index.html'), '<!doctype html><title>Element fixture</title>');
  writeFileSync(join(element, 'usercontent/index.html'), '<!doctype html><title>Media sandbox</title><p>Sandbox ready</p>');
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Management fixture</title>');
  writeFileSync(join(directory, 'outside.html'), 'private file');
  symlinkSync(join(directory, 'outside.html'), join(element, 'escape.html'));
  symlinkSync(directory, join(element, 'escape'));
  const routes = { element, web, publicOrigin: 'http://127.0.0.1', matrixOrigin: 'http://127.0.0.1', service: createServer() };
  const server = publicRouter({ get publicOrigin() { return routes.publicOrigin; }, service: routes.service, web: routes.web, backend: matrixPublicRoutes(routes) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  routes.publicOrigin += ':' + address.port;
  cleanup(scope, async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return routes.publicOrigin;
}

test('only exact current native registration and fallback paths reach Crossfire; removed forms never reach Matrix', async scope => {
  const management: string[] = [], matrix: string[] = [];
  async function listen(server: Server) {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    cleanup(scope, () => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
    return 'http://127.0.0.1:' + address.port;
  }
  const service = createServer((request, response) => { management.push(request.url!); response.end('management'); });
  const matrixOrigin = await listen(createServer((request, response) => { matrix.push(request.url!); response.end('matrix'); }));
  const routes = { publicOrigin: 'http://127.0.0.1', service, matrixOrigin, web: '/', element: '/' };
  const router = publicRouter({ get publicOrigin() { return routes.publicOrigin; }, service: routes.service, web: routes.web, backend: matrixPublicRoutes(routes) }); routes.publicOrigin = await listen(router);
  const origin = new URL(routes.publicOrigin);
  const request = (path: string) => new Promise<{ status: number; cache: string | undefined }>((resolve, reject) => {
    const operation = send({ hostname: origin.hostname, port: origin.port, path, method: 'POST' }, response => {
      response.resume(); response.once('end', () => resolve({ status: response.statusCode!, cache: response.headers['cache-control'] }));
    }); operation.once('error', reject); operation.end('{}');
  });
  const register = '/_matrix/client/v3/register', fallback = '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web';
  for (const path of [register + '?kind=user', fallback + '?session=exact']) assert.equal((await request(path)).status, 200);
  assert.deepEqual(management, [register + '?kind=user', fallback + '?session=exact']); assert.deepEqual(matrix, []);
  for (const path of [register.replace('/v3/', '/r0/'), register.replace('/v3/', '/v1/'), register.replace('/v3/', '/unknown/'),
    register.replace('/v3/', '/'), register + '/', register + '//', register.replace('register', 'reg%69ster'),
    register.replace('/v3/', '/%76%33/'), '/_matrix/client/v3/../v3/register',
    fallback.replace('/v3/', '/r0/'), fallback.replace('/v3/', '/unknown/'), fallback.replace('/v3/', '/'), fallback + '/',
    fallback.replace('fallback', 'fall%62ack'), '/_matrix/client/v3/../v3/auth/org.crossfire.login.registration/fallback/web']) {
    const response = await request(path); assert.equal(response.status, 404, path); assert.equal(response.cache, 'no-store', path);
  }
  assert.equal(management.length, 2); assert.deepEqual(matrix, []);
  assert.equal((await request('/_matrix/client/v3/sync')).status, 200); assert.deepEqual(matrix, ['/_matrix/client/v3/sync']);
});

test('Element media directory serves its HTML index with same-origin framing, while application pages deny framing', async scope => {
  const origin = await fixture(scope);
  for (const path of ['/usercontent/', '/usercontent/index.html']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), null);
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'self'");
    assert.match(await response.text(), /Sandbox ready/u);
    const head = await fetch(origin + path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), response.headers.get('content-type'));
    assert.equal(head.headers.get('content-length'), response.headers.get('content-length'));
    assert.equal(await head.text(), '');
  }
  for (const path of ['/', '/index.html', '/manage/', '/manage/agents']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    if (path.startsWith('/manage/')) assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/u);
  }
});

test('directory indexes cannot expose private files, missing assets or symlink targets outside the static root', async scope => {
  const origin = await fixture(scope);
  for (const path of ['/absent/', '/usercontent/missing.html', '/.private/', '/%2e%2e%2foutside.html',
    '/escape.html', '/escape/', '/escape/outside.html', '/usercontent/%00', '/usercontent/%5c', '/usercontent/%zz']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  assert.equal((await fetch(origin + '/usercontent/', { method: 'POST' })).status, 405);
});

test('browser admits the native opaque media sandbox but rejects cross-origin and management framing', async scope => {
  const origin = await fixture(scope);
  const outside = await fixture(scope);
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
  cleanup(scope, () => browser.close());
  const page = await browser.newPage();
  await page.goto(origin);
  await page.setContent('<iframe sandbox="allow-scripts allow-downloads" src="/usercontent/"></iframe>');
  await expect(page.frameLocator('iframe').getByText('Sandbox ready')).toBeVisible();
  const sandbox = page.frames().find(frame => frame !== page.mainFrame());
  assert(sandbox);
  assert.equal(await sandbox.evaluate('self.origin'), 'null');
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(outside);
  await page.setContent('<iframe sandbox="allow-scripts allow-downloads" src="' + origin + '/usercontent/"></iframe>');
  await expect.poll(() => errors.some(error => error.includes('frame-ancestors'))).toBe(true);
  await expect(page.frameLocator('iframe').getByText('Sandbox ready')).toHaveCount(0);
  errors.length = 0;
  await page.goto(origin);
  await page.setContent('<iframe src="/manage/"></iframe>');
  await expect.poll(() => errors.some(error => /frame-ancestors|X-Frame-Options/u.test(error))).toBe(true);
});
