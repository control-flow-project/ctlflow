import assert from 'node:assert/strict';
import { once } from 'node:events';
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
  const routes = { element, web, publicOrigin: 'http://127.0.0.1', matrixOrigin: 'http://127.0.0.1', serviceOrigin: 'http://127.0.0.1' };
  const server = publicRouter(routes);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  routes.publicOrigin += ':' + address.port;
  scope.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return routes.publicOrigin;
}

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
  scope.after(() => browser.close());
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
