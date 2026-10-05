import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { value } from './support/application.js';
import { elementAssets } from './support/element.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { browserOptions } from './support/tls.js';

test('stock Element uses Crossfire English activity wording', { timeout: 120000 }, async scope => {
  const { origin, native } = await nativeServer(scope, await releaseFixture(), {}, elementAssets());
  const viewer = await native.register('viewer');
  const participants = [];
  for (const name of ['ada', 'bea', 'kit', 'lou']) {
    const account = await native.register(name);
    value(await nativeOk({ base: origin, token: account.token }, 'PUT', API + '/profile/' + segment(account.id) + '/displayname', { displayname: name }));
    participants.push(account);
  }
  const created = value(await nativeOk({ base: origin, token: viewer.token }, 'POST', API + '/createRoom', {
    name: 'Thinking indicator', preset: 'private_chat', invite: participants.map(account => account.id),
  }));
  assert.equal(typeof created.room_id, 'string');
  const room = created.room_id as string;
  for (const account of participants) value(await nativeOk({ base: origin, token: account.token }, 'POST', API + '/join/' + segment(room), {}));
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const page = await browser.newPage();
  const evidence = join(process.cwd(), '.temp/element-thinking');
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  cleanup(scope, async () => {
    await page.screenshot({ path: join(evidence, 'final.png'), fullPage: true });
  });
  page.setDefaultTimeout(15000);
  const translations = page.waitForResponse(response => response.url() === origin + '/manage/assets/element-translations.json');
  await page.goto(origin + '/#/login');
  assert.equal((await translations).status(), 200);
  await page.getByLabel('Username', { exact: true }).fill(viewer.id);
  await page.getByLabel('Password', { exact: true }).fill(viewer.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0, { timeout: 40000 });
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(viewer.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Setting up keys', exact: true })).toHaveCount(0);
  await page.goto(origin + '/#/room/' + encodeURIComponent(room));
  await expect(page.getByRole('region', { name: 'Message composer', exact: true }).getByRole('textbox')).toBeVisible({ timeout: 15000 });
  const indicator = page.getByText(/\b(?:is|are) thinking …$/u);
  for (const [index, account] of participants.entries()) {
    value(await nativeOk({ base: origin, token: account.token }, 'PUT', API + '/rooms/' + segment(room) + '/typing/' + segment(account.id), { typing: true, timeout: 30000 }));
    await expect(indicator).toHaveCount(1);
    if (index === 0) await expect(indicator).toHaveText('ada is thinking …');
    else if (index === 1) await expect(indicator).toHaveText(/^(?:ada and bea|bea and ada) are thinking …$/u);
    else if (index === 2) {
      await expect(indicator).toContainText('kit');
      await expect(indicator).toHaveText(/^\w+, \w+ and \w+ are thinking …$/u);
      for (const name of ['ada', 'bea', 'kit']) await expect(indicator).toContainText(name);
    } else await expect(indicator).toHaveText(/\b2 others are thinking …$/u);
    await expect(page.getByText(/\b(?:is|are) typing …$/u)).toHaveCount(0);
  }
  await page.screenshot({ path: join(evidence, 'thinking.png'), fullPage: true });
});
