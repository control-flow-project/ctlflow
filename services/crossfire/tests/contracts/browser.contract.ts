import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { browserOptions } from '../../node/tests/support/tls.js';
import type { ContractStack } from './fixture.js';

export async function browserContracts(scope: TestContext, fixture: ContractStack): Promise<void> {
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) await scope.test('unchanged management UI works at ' + viewport.width + 'px', async () => {
    const context = await browser.newContext({ viewport }); cleanup(scope, () => context.close()); const cookie = fixture.owner.cookie.indexOf('=');
    await context.addCookies([{ name: fixture.owner.cookie.slice(0, cookie), value: fixture.owner.cookie.slice(cookie + 1), url: fixture.origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { errors.push('Unexpected browser confirmation popup'); void dialog.dismiss(); });
    await page.goto(fixture.origin + '/manage/fleets'); await expect(page.getByRole('heading', { name: 'Fleets', exact: true })).toBeVisible();
    await page.goto(fixture.origin + '/manage/agents'); await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'), 'Management layout remains inside its viewport'); assert.deepEqual(errors, []);
  });
}

export async function publicationBrowser(url: string): Promise<void> {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage();
    await page.goto(url);
    await expect(page.locator('body')).toHaveAttribute('data-report', 'ready');
    assert.equal(await page.locator('body').getAttribute('data-origin'), 'null', 'Published scripts execute at an opaque origin');
    assert.equal(await page.locator('body').getAttribute('data-cookie'), 'blocked', 'Published scripts cannot read cookies');
    assert.equal(await page.locator('body').getAttribute('data-storage'), 'blocked', 'Published scripts cannot read origin storage');
  } finally { await browser.close(); }
}
