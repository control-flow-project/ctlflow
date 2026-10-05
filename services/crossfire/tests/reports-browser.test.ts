import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createClient, type Client } from '@crossfire/adapter-crossfire/client';
import { operations } from '@crossfire/contracts/rest/operations';
import { binaryBytes } from '@crossfire/kernel/bytes';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';

async function stage(client: Client, title: string, assets = false) {
  const files = [{ path: 'index.html', mediaType: 'text/html', content: '<!doctype html><title>Report</title><script>globalThis.reportSideEffect = true</script><h1>Credit review</h1>' },
    ...(assets ? Array.from({ length: 21 }, (_, index) => ({ path: 'assets/source-' + String(index).padStart(2, '0') + '.json', mediaType: 'application/json', content: JSON.stringify({ page: index + 1 }) })) : [])];
  const report = value(await client.call(operations.createPublication, {}, { title, files: files.map(file => ({ path: file.path, mediaType: file.mediaType,
    bytes: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') })) })).data;
  return { report, files };
}
async function publish(client: Client, title: string, assets = false) {
  const staged = await stage(client, title, assets);
  for (const file of staged.report.files) {
    const source = staged.files.find(source => source.path === file.path); assert(source);
    const receipt = value(await client.call(operations.uploadPublicationFile, { publicationId: staged.report.id, fileId: file.id }, binaryBytes(Buffer.from(source.content))));
    assert.equal(receipt.data.uploaded, true);
  }
  const complete = value(await client.call(operations.publication, { publicationId: staged.report.id }, {})).data;
  const report = value(await client.call(operations.commitPublication, { publicationId: complete.id }, { expectedRevision: complete.revision })).data;
  assert.equal(report.state, 'published'); assert(report.url);
  return report;
}

test('Reports browser inventory, durable files view and confirmed deletion use the canonical publication APIs', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { admin, origin } = fixture;
  const alice = await fixture.member('alice'), owned = await fixture.agent(admin.actor, 'ada'), foreign = await fixture.agent(alice.actor, 'visitor');
  const client = createClient({ origin, token: owned.token }), otherClient = createClient({ origin, token: foreign.token });
  const title = 'Credit review <img src=x onerror="globalThis.reportSideEffect=true">';
  const report = await publish(client, title, true), otherReport = await publish(otherClient, 'Alice credit review');
  for (let index = 0; index < 21; index++) await stage(client, 'Draft review ' + String(index).padStart(2, '0'));
  mkdirSync('.temp', { recursive: true }); const directory = mkdtempSync(join(process.cwd(), '.temp/reports-browser-'));
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
  cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage(), errors: string[] = [], failures: string[] = [], contentRequests: string[] = [], deletions: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) failures.push(response.status() + ' ' + response.url()); });
  page.on('request', request => {
    if (request.url().startsWith(fixture.application.config.contentOrigin + '/')) contentRequests.push(request.url());
    if (request.method() === 'DELETE') deletions.push(request.url());
  });
  await page.goto(origin + '/manage/reports');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
  const table = page.getByRole('table', { name: 'Reports', exact: true });
  await expect(table.getByRole('columnheader')).toHaveText(['Report', 'Created by', 'Owner', 'Created', 'Status', 'Public link']);
  await expect(table.locator('tbody tr')).toHaveCount(20); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'reports-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(origin + '/manage/reports?page=2'); await expect(table.locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('Publication status', { exact: true }).selectOption('published');
  await page.getByLabel('Owner', { exact: true }).selectOption(alice.actor.principalId);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Search', exact: true }).click()]);
  await expect(table.locator('tbody tr')).toHaveCount(1); await expect(table).toContainText(otherReport.title);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await page.getByLabel('Search reports', { exact: true }).fill('Credit review <img');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Search', exact: true }).click()]);
  await expect(table.locator('tbody tr')).toHaveCount(1); await expect(table).toContainText(title);
  const publicLink = table.getByRole('link', { name: 'Open report ' + title, exact: true });
  await expect(publicLink).toHaveAttribute('href', report.url!); await expect(publicLink).toHaveAttribute('target', '_blank');
  await expect(publicLink).toHaveAttribute('rel', 'noopener noreferrer');
  assert.notEqual(new URL(report.url!).origin, origin);
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'reports-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByLabel('Public URL', { exact: true })).toHaveValue(report.url!);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByText('Link copied. Anyone with it can view this report.', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate<string>('navigator.clipboard.readText()'), report.url!);
  await expect(page.getByRole('region', { name: 'Public access', exact: true })).toContainText('Anyone who has it can view this report');
  await expect(page.locator('.page-frame img, .page-frame iframe')).toHaveCount(0);
  assert.equal(await page.evaluate<boolean>('globalThis.reportSideEffect === true'), false, 'Hostile report titles and content never execute in management');
  assert.deepEqual(contentRequests, [], 'Management does not fetch or embed report content');
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'report-desktop.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Report sections' }).getByRole('link', { name: 'Files', exact: true }).click();
  const files = page.getByRole('table', { name: 'Report files', exact: true });
  await expect(files.locator('tbody tr')).toHaveCount(20); await expect(files).toContainText('Recorded');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(origin + '/manage/reports/' + report.id + '/files?filesPage=2'); await expect(files.locator('tbody tr')).toHaveCount(2);
  await page.reload(); await expect(files.locator('tbody tr')).toHaveCount(2); await checkPaperLayout(page);
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'report-files-mobile.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Report sections' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'report-mobile.png'), fullPage: true });
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Delete report', exact: true }).click();
  assert.deepEqual(deletions, [], 'Cancelling confirmation does not make a destructive request');
  assert.equal(value(await client.call(operations.publication, { publicationId: report.id }, {})).data.state, 'published');
  page.once('dialog', async dialog => { assert(dialog.message().includes('Copies already saved')); await dialog.accept(); });
  const deleted = page.waitForResponse(response => response.url().endsWith('/api/publications/' + report.id) && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Delete report', exact: true }).click(); assert.equal((await deleted).status(), 200);
  await expect(page.getByRole('button', { name: 'Delete report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Public access', exact: true })).toContainText('Its public link is no longer available');
  await expect(page.getByRole('link', { name: 'Open report ↗', exact: true })).toHaveCount(0);
  assert.equal(value(await client.call(operations.publication, { publicationId: report.id }, {})).data.state, 'deleted');
  assert.equal(deletions.length, 1); await checkPaperLayout(page);
  await page.goto(origin + '/manage/reports?state=deleted'); await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.goto(origin + '/manage/reports?search=NoMatchingPublication');
  await expect(page.getByRole('heading', { name: 'No matching reports', exact: true })).toBeVisible();
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'reports-empty-mobile.png'), fullPage: true });
  await page.goto(origin + '/manage/audit?pageSize=100');
  const audit = page.getByRole('table', { name: 'Management activity', exact: true });
  await expect(audit).toContainText('Prepare report'); await expect(audit).toContainText('Publish report'); await expect(audit).toContainText('Delete report');

  const memberContext = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await memberContext.addCookies([{ name: COOKIE_NAME, value: alice.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const memberPage = await memberContext.newPage(); await memberPage.goto(origin + '/manage/reports');
  await expect(memberPage.getByRole('table', { name: 'Reports', exact: true }).locator('tbody tr')).toHaveCount(1);
  await expect(memberPage.getByRole('columnheader', { name: 'Owner', exact: true })).toHaveCount(0);
  await expect(memberPage.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await memberPage.getByRole('link', { name: otherReport.title, exact: true }).click();
  await expect(memberPage.getByRole('button', { name: 'Delete report', exact: true })).toBeVisible(); await checkPaperLayout(memberPage);
  await memberPage.goto(origin + '/manage/reports/' + report.id);
  await expect(memberPage.getByRole('alert')).toBeVisible(); await expect(memberPage.getByRole('button', { name: 'Delete report', exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  scope.diagnostic('Real API browser screenshots: ' + directory);
});
