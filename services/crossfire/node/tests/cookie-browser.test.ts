import assert from 'node:assert/strict';
import test from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { chromium } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { setCookie } from '../apps/server/src/http/transport.js';
import { setInvitationCookie } from '../apps/server/src/http/invitation-cookie.js';

test('real Chromium accepts host-only secure credentials and rejects sibling Domain-cookie injection', async scope => {
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true }); cleanup(scope, () => browser.close());
  const context = await browser.newContext(), page = await context.newPage(), credential = 'a'.repeat(43);
  const origin = 'https://crossfire.test', content = 'https://content.crossfire.test';
  const values = [['__Host-crossfire', credential], ['__Host-crossfire-invitation', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.' + credential]];
  const siblingCookies: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), response = new ServerResponse(new IncomingMessage(new Socket()));
    const invitation = url.pathname.endsWith('/invitation'), expected = values[invitation ? 1 : 0]!;
    if (url.origin === origin) {
      if (invitation) setInvitationCookie(response, expected[1]!); else setCookie(response, expected[1]!);
    } else {
      siblingCookies.push((await route.request().allHeaders()).cookie ?? '');
      response.setHeader('Set-Cookie', expected[0] + '=attacker; Domain=crossfire.test; Path=/; Secure; SameSite=Strict');
    }
    await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Set-Cookie': String(response.getHeader('Set-Cookie')) }, body: '<!doctype html><title>Cookie boundary fixture</title>' });
  });
  await page.goto(origin + '/session'); await page.goto(origin + '/invitation');
  const before = (await context.cookies(origin)).sort((left, right) => left.name.localeCompare(right.name));
  assert.equal(before.length, 2); assert(before.every(cookie => cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.domain === 'crossfire.test' && cookie.path === '/'));
  await page.goto(content + '/session'); await page.goto(content + '/invitation');
  assert.deepEqual((await context.cookies(origin)).sort((left, right) => left.name.localeCompare(right.name)), before);
  assert.deepEqual(siblingCookies, ['', '']); assert.equal(await page.evaluate('document.cookie'), '');
});
