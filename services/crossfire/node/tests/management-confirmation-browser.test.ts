import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { success } from '@ctlflow/crossfire-kernel/result';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { browserOptions } from '@ctlflow/crossfire-test-support/tls';
import { value } from './support/application.js';
import { mapFleet } from './support/map-fleet.js';
import { browserController } from './support/browser-controller.js';

test('themed confirmations isolate focus, cancel without writes, retain failed requests and prevent pending dismissal or duplicates', { timeout: 120000 }, async scope => {
  const { services, admin, origin, agent: createAgent } = await nativeServer(scope, await releaseFixture());
  const agent = await createAgent(admin.actor, 'confirmation');
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser popup'); void dialog.dismiss(); });
  let requests = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); cleanup(scope, () => release());
  await page.route('**/api/agents/' + agent.id, async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    requests++;
    if (requests > 1) { await route.continue(); return; }
    await pending; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
      error: { code: 'unavailable', message: 'Retry the unchanged request <not HTML>' }, meta: { requestId: randomUUID() } }) });
  });
  await page.goto(origin + '/manage/agents/' + agent.id + '/settings');
  const trigger = page.getByRole('button', { name: 'Suspend agent', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Suspend agent?', exact: true });
  await trigger.click(); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await checkPaperLayout(page);
  const bounds = await dialog.boundingBox(); assert(bounds && bounds.width <= 374 && bounds.height < 844);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab'); assert(await page.evaluate<boolean>('document.querySelector("dialog").contains(document.activeElement)'));
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  assert.equal(requests, 0); assert.equal(value(services.directory.agent(agent.id))!.principal.status, 'active');
  assert.equal(await page.evaluate<string>('document.documentElement.style.overflow'), '');
  await trigger.click(); await dialog.getByRole('button', { name: 'Suspend agent', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); assert.equal(requests, 1);
  release(); await expect(dialog.getByRole('alert')).toHaveText('Retry the unchanged request <not HTML>');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Suspend agent', exact: true }).click()]);
  await expect(page.getByRole('button', { name: 'Activate agent', exact: true })).toBeVisible();
  assert.equal(requests, 2); assert.equal(value(services.directory.agent(agent.id))!.principal.status, 'suspended');
  await expect(page.getByRole('dialog')).toHaveCount(0); assert.deepEqual(errors, []);
});

test('fleet session controls track the current operation even while viewing older history pages', { timeout: 120000 }, async scope => {
  const { services, admin, origin } = await nativeServer(scope, await releaseFixture());
  const { fleet, controller } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId, 1);
  const now = services.clock.now();
  for (let index = 0; index < 11; index++) value(services.repositories.fleetRuntimeOperation.insert({ operationId: randomUUID(), fleetId: fleet.id,
    authorPrincipalId: admin.actor.principalId, action: 'start', agentId: null, expectedRevision: 0, status: 'succeeded',
    createdAt: now - 200 - index, completedAt: now - 100 - index, errorMessage: null, connectionId: controller.connectionId,
    credentialId: value(services.repositories.fleetConnection.find(fleet.id))!.credentialId }));
  let release!: () => void, executions = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await browserController(scope, { origin, controller, owner: admin.member.principal.matrixUserId,
    execute: async () => { executions++; await pending; return success({ status: 'succeeded', errorMessage: null }); } });
  cleanup(scope, () => release());
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  const context = await browser.newContext();
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  await page.goto(origin + '/manage/fleets/' + fleet.id + '/sessions?sessionsPage=2');
  const resume = page.getByRole('button', { name: 'Resume sessions', exact: true });
  await expect(resume).toBeEnabled(); await resume.click();
  await expect(page.getByRole('table', { name: 'Session operations', exact: true })).toContainText('running');
  await page.goto(origin + '/manage/fleets/' + fleet.id + '/sessions?sessionsPage=2');
  await expect(page.getByRole('table', { name: 'Session operations', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Session operations', exact: true })).not.toContainText('running');
  await expect(resume).toBeDisabled(); await expect(page.getByRole('button', { name: 'Stop sessions', exact: true })).toBeDisabled();
  await expect(page.getByText('A session operation is awaiting the controller’s completion.', { exact: false })).toBeVisible();
  release(); await expect(resume).toBeEnabled({ timeout: 10000 }); assert.equal(executions, 1);
});
