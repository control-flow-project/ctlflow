import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { browserOptions, secureProxy } from '../support/tls.js';
import type { ContractStack } from './fixture.js';

export async function browserContracts(scope: TestContext, fixture: ContractStack): Promise<void> {
  const secure = await secureProxy(scope, fixture.origin), previous = fixture.configuration.publicOrigin;
  await fixture.setPublicOrigin(secure.origin); cleanup(scope, () => fixture.setPublicOrigin(previous));
  const browser = await chromium.launch({ ...browserOptions, env: { ...process.env, TMPDIR: '.temp', TMP: '.temp', TEMP: '.temp' } }); cleanup(scope, () => browser.close());
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) await scope.test('unchanged management UI works at ' + viewport.width + 'px', async () => {
    const context = await browser.newContext({ viewport }); cleanup(scope, () => context.close()); const cookie = fixture.owner.cookie.indexOf('=');
    await context.addCookies([{ name: fixture.owner.cookie.slice(0, cookie), value: fixture.owner.cookie.slice(cookie + 1), url: secure.origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { errors.push('Unexpected browser confirmation popup'); void dialog.dismiss(); });
    await page.goto(secure.origin + '/manage/fleets'); await expect(page.getByRole('heading', { name: 'Fleets', exact: true })).toBeVisible();
    await page.goto(secure.origin + '/manage/agents'); await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'), 'Management layout remains inside its viewport'); assert.deepEqual(errors, []);
  });
}
