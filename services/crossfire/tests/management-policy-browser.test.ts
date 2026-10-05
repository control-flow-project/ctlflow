import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { operations } from '@crossfire/contracts/rest/operations';
import { decodeResponse } from '@crossfire/contracts/rest/envelope';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { browserOptions } from './support/tls.js';

async function idleSeconds(page: Page, origin: string): Promise<number> {
  const response = await page.request.get(origin + operations.policy.path); assert.equal(response.status(), 200);
  const payload: unknown = await response.json();
  return value(decodeResponse(payload, operations.policy.output, false)).data.fleetIdleTimeoutSeconds;
}

test('Policy browser edits idle sleep in minutes, validates durations and keeps the canonical seconds setting', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { admin, origin } = fixture;
  const member = await fixture.member('alice');
  mkdirSync('.temp', { recursive: true }); const directory = mkdtempSync(join(process.cwd(), '.temp/idle-policy-browser-'));
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/manage/policy');
  const minutes = page.getByLabel('Sleep after idle minutes', { exact: true }), save = page.getByRole('button', { name: 'Save settings', exact: true });
  await expect(minutes).toHaveValue('30'); assert.equal(await idleSeconds(page, origin), 1800);
  await expect(page.getByRole('region', { name: 'Fleet idle sleep', exact: true })).toContainText('Directly connected agents are never stopped');
  for (const invalid of ['', '-1', '0.001', '10081']) {
    await minutes.fill(invalid); await expect(minutes).toHaveAttribute('aria-invalid', 'true'); await expect(save).toBeDisabled();
    assert.equal(await idleSeconds(page, origin), 1800, 'Invalid local input never changes the persisted policy');
  }
  await minutes.fill('45.5'); await expect(save).toBeEnabled(); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'idle-policy-desktop.png'), fullPage: true });
  await Promise.all([page.waitForEvent('load'), save.click()]); await expect(minutes).toHaveValue('45.5'); assert.equal(await idleSeconds(page, origin), 2730);
  await minutes.fill('0'); await Promise.all([page.waitForEvent('load'), save.click()]);
  await expect(minutes).toHaveValue('0'); assert.equal(await idleSeconds(page, origin), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'idle-policy-mobile.png'), fullPage: true });
  const memberContext = await browser.newContext();
  await memberContext.addCookies([{ name: COOKIE_NAME, value: member.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const memberPage = await memberContext.newPage(); await memberPage.goto(origin + '/manage/agents');
  await expect(memberPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await memberPage.goto(origin + '/manage/policy'); await expect(memberPage.getByLabel('Sleep after idle minutes', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible();
  assert.deepEqual(errors, []); scope.diagnostic('Real API browser screenshots: ' + directory);
});
