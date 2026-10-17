import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { browserOptions } from '@ctlflow/crossfire-test-support/tls';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContractStack } from './fixture.js';
import { managementBrowserContracts, managementBrowserFixture } from './management-browser.contract.js';

export async function browserContracts(scope: TestContext, fixture: ContractStack): Promise<void> {
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  const state = await managementBrowserFixture(fixture);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) await scope.test('unchanged management UI works at ' + viewport.width + 'px', async child => {
    const renewal = new AbortController();
    const renewing = (async () => {
      try {
        while (!renewal.signal.aborted) {
          await fixture.operation(operations.reportFleetConnection, { fleetId: state.agent.fleetId, connectionId: state.agent.connectionId }, { stopped: false }, state.agent.credential);
          await delay(10000, undefined, { signal: renewal.signal });
        }
      } catch (error) { if (!(renewal.signal.aborted && error instanceof Error && error.name === 'AbortError')) throw error; }
    })();
    void renewing.catch(() => {});
    cleanup(child, async () => { renewal.abort(); await renewing; });
    const context = await browser.newContext({ viewport }); cleanup(child, () => context.close()); const cookie = fixture.owner.cookie.indexOf('=');
    await context.addCookies([{ name: fixture.owner.cookie.slice(0, cookie), value: fixture.owner.cookie.slice(cookie + 1), url: fixture.origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { errors.push('Unexpected browser confirmation popup'); void dialog.dismiss(); });
    await page.goto(fixture.origin + '/manage/fleets'); await expect(page.getByRole('heading', { name: 'Fleets', exact: true })).toBeVisible();
    await expect(page).toHaveTitle('crossfire · Management'); await expect(page.locator('.brand')).toHaveText('crossfire↗');
    await page.goto(fixture.origin + '/manage/agents'); await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    await managementBrowserContracts(page, fixture, state, viewport.width);
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
