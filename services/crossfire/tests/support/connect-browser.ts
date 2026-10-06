import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { onboardingUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { checkPaperLayout } from '../../tools/browser/layout.js';

export async function checkEnrollmentInstructions(page: Page, origin: string, owner: string): Promise<string> {
  await page.goto(origin + '/manage/connect');
  const field = page.getByLabel('Instructions for your agent', { exact: true });
  await expect(field).toBeVisible();
  await checkPaperLayout(page);
  await expect(field).toHaveAttribute('readonly', '');
  const instructions = await field.inputValue();
  const health = (await (await page.request.get(origin + '/api/health')).json() as { data: { release: string } }).data;
  const base = origin + '/onboarding/' + health.release + '/';
  const setupUrl = onboardingUrl(origin, owner);
  assert.equal(instructions, 'Follow the setup instructions at ' + setupUrl + '.');
  assert(instructions.length < 500, 'The copied connection message is concise');
  assert.equal(instructions.split('\n').length, 1);
  for (const content of ['curl ', 'sha256sum', 'README.md', 'manifest.json', 'SKILL.md', 'crossfire-client.mjs']) assert(!instructions.includes(content));
  assert(!instructions.includes('$SERVER'));
  assert(!instructions.includes('$OWNER'));
  const details = page.locator('details.setup-details');
  await expect(details).not.toHaveAttribute('open', '');
  const guideResponse = await fetch(setupUrl);
  assert.equal(guideResponse.status, 200, 'An agent can read the guide without a human session cookie');
  const guide = await guideResponse.text();
  assert(guide.includes('Codex'));
  for (const removed of ['Claude Code', 'runcodex.sh', 'agent connect', 'agent listen']) assert(!guide.includes(removed), 'Removed standalone instructions are not offered: ' + removed);
  await expect(page.getByText('your current coding session stays independent', { exact: false })).toBeVisible();
  assert(guide.includes('@ctlflow/fleet'));
  assert(guide.includes('fleet setup'));
  assert(/readiness|ready/iu.test(guide));
  assert(guide.includes('Linux or macOS'));
  assert(guide.includes('https://nodejs.org/en/download'));
  assert(guide.includes(owner));
  await expect(page.getByRole('link', { name: 'Read the full guide for your account →', exact: true })).not.toBeVisible();
  await details.locator('summary').click();
  await expect(page.getByRole('link', { name: 'Read the full guide for your account →', exact: true })).toHaveAttribute('href', setupUrl);
  await expect(page.getByRole('link', { name: 'Download optional runcodex.sh' })).toHaveCount(0);
  const names = ['manifest.json', ...ARTIFACTS];
  for (const name of names) {
    assert.equal((await fetch(base + name)).status, 200);
  }
  await expect(page.getByRole('link', { name: 'Review enrollment requests →', exact: true })).toHaveAttribute('href', '/manage/enrollments');
  await expect(page.getByRole('heading', { name: 'Set up an agent', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approve the enrollment', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose where your agent works', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Connection type', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'One agent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Fleet · advanced', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Rooms', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage rooms →', exact: true })).toHaveCount(0);
  await expect(page.getByText('Approval alone creates no chats or room access.', { exact: false })).toBeVisible();
  assert(!instructions.includes('--session'));
  assert(!instructions.includes('--token-file'));
  await page.reload();
  await expect(field).toHaveValue(instructions);
  await expect(details).not.toHaveAttribute('open', '');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.bringToFront();
  await page.getByRole('button', { name: 'Copy instructions', exact: true }).click();
  await expect(page.locator('.copy-text').getByRole('status')).toHaveText('Copied. Paste into your coding agent.');
  assert.equal(await page.evaluate<string>('navigator.clipboard.readText()'), instructions);
  return instructions;
}

export async function reviewLayouts(page: Page, origin: string, directory: string, role: 'administrator' | 'member', routes: string[]) {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [index, route] of routes.entries()) {
      await page.goto(origin + route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await checkPaperLayout(page);
      if (viewport.width === 1920) {
        if (route === '/manage/connect') {
          const gutters = await page.locator('.setup-step > div').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left));
          assert.equal(gutters.length, 3);
          assert(gutters.every(left => left === gutters[0]), 'All illustrated steps share one text gutter');
        }
      }
      await page.screenshot({ path: join(directory, 'review-' + role + '-' + viewport.width + '-' + index + '.png'), fullPage: true });
    }
  }
}
