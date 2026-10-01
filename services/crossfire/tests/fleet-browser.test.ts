import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value, secret } from './support/application.js';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { createFleetControlConnection } from '@crossfire/adapter-crossfire/fleet-control';
import { API } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { checkPaperLayout } from './support/browser-layout.js';
import { mapFleet } from './support/map-fleet.js';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { reportListener } from '@crossfire/domain/listener/report';
import { WAKE_POLICIES, WAKE_LABELS } from '@crossfire/contracts/wake';

test('browser fleet review, room-plan confirmation, invitation delegation and selected wake identities share canonical APIs', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const directory = mkdtempSync(join(process.cwd(), '.temp/fleet-browser-'));
  const other = await fixture.member('alice'), guest = await fixture.agent(other.actor, 'visitor');
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: admin.member.principal.matrixUserId, fleetKey: 'research',
    controller: { name: 'Research workstation', metadata: { site: 'local' } }, instances: [{ instanceKey: 'alpha', name: 'alpha' }, { instanceKey: 'beta', name: 'beta' }] };
  const introduced = value(await introduceEnrollment(services, input));
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
  scope.after(() => browser.close());
  const context = await browser.newContext(); await context.addCookies([{ name: 'crossfire', value: admin.secret, url: origin }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/manage/enrollments/' + input.enrollmentId);
  await expect(page.getByText('Research workstation', { exact: true })).toBeVisible();
  await expect(page.getByText('alpha', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Verification code').fill(introduced.request.verificationCode);
  await page.getByRole('button', { name: 'Approve roster', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Agent details →' })).toHaveCount(2); await worker.drain();
  const fleet = value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: 'research' }))!;
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  const control = createFleetControlConnection({ origin, credential: ready.fleet!.controllerCredential!, fleetId: fleet.id,
    owner: admin.member.principal.matrixUserId, signal: new AbortController().signal });
  scope.after(() => control.close());
  const instances = value(services.collection.fleetInstances({ ownerId: admin.actor.principalId, fleetKey: 'research' }));
  const alpha = instances.find(instance => instance.instanceKey === 'alpha')!;
  const roomId = value(await nativeOk({ base: fixture.native.base, token: admin.token }, 'POST', API + '/createRoom', { name: 'Research', preset: 'private_chat' })).room_id as string;
  await page.goto(origin + '/manage/fleets');
  await page.getByLabel('Search fleets or controllers').fill('workstation');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Apply filters', exact: true }).click()]);
  await expect(page.locator('.agent-card')).toHaveCount(1);
  await page.getByRole('heading', { name: 'research', exact: true }).click();
  const delivery = page.getByRole('region', { name: 'Fleet delivery', exact: true });
  await expect(delivery.getByText('online', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Deactivate fleet' }).click();
  assert.equal(value(services.repositories.fleet.findById(fleet.id))!.deliveryEnabled, true);
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Deactivate fleet' }).click()]);
  await expect(page.getByRole('button', { name: 'Activate fleet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to fleet', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Activate fleet' }).click()]);
  await expect(page.getByRole('button', { name: 'Deactivate fleet', exact: true })).toBeVisible();
  await page.getByLabel('Message the fleet').fill('Browser-reviewed explicit fleet task');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Send to fleet', exact: true }).click();
  assert.equal(value(services.repositories.fleetMessage.page(fleet.id, { page: 1, pageSize: 10 })).totalItems, 0);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Send to fleet', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Fleet messages', exact: true })).toContainText('Browser-reviewed explicit fleet task');
  await expect(page.getByRole('table', { name: 'Fleet messages', exact: true }).locator('tbody tr').first().getByRole('cell').nth(4)).toHaveText('2', { timeout: 10000 });
  for (let index = 0; index < 10; index++) value(await control.message({ messageId: randomUUID(), body: 'Paginated fleet task ' + index }));
  await page.reload();
  const history = page.getByRole('region', { name: 'Fleet messages', exact: true });
  await expect(history.locator('tbody tr')).toHaveCount(10);
  await history.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(origin + '/manage/fleets/' + fleet.id + '?messagesPage=2');
  await expect(history.locator('tbody tr')).toHaveCount(1);
  await expect(history.getByRole('table')).toContainText('Browser-reviewed explicit fleet task');
  await history.getByRole('link', { name: 'Previous' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByLabel('Fleet label')).toHaveValue('research');
  await page.getByLabel('Fleet label').fill('Research team');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save label' }).click()]);
  await expect(page.getByLabel('Fleet label')).toHaveValue('Research team');
  const toml = 'fleet = "research"\n[[agents]]\ninstance = "alpha"\n[[agents.grants]]\nroom = ' + JSON.stringify(roomId) + '\naccess = "reply"\nmuted = false\n';
  await page.getByLabel('Room plan TOML').fill(toml);
  await page.getByRole('button', { name: 'Preview room access' }).click();
  const plan = page.getByRole('region', { name: 'Room plan', exact: true });
  await expect(plan.getByRole('link', { name: 'Research', exact: true })).toBeVisible();
  await expect(plan.getByText('Change access', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Apply reviewed plan' }).click();
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId })), null);
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Apply reviewed plan' }).click()]);
  await worker.drain();
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId }))!.accessMode, 'reply');
  const agentUrl = '/manage/agents/' + alpha.agentId;
  await page.goto(origin + agentUrl + '/rooms/' + encodeURIComponent(roomId));
  await page.getByLabel('Allow this agent to invite other registered agents').check();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save invitation permission' }).click()]);
  await expect(page.getByLabel('Allow this agent to invite other registered agents')).toBeChecked();
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: alpha.agentId, roomId })).map(permission => permission.permissionCode), ['room.agent.invite']);
  await page.goto(origin + agentUrl);
  await page.getByLabel('Wake-up authority').selectOption('selected');
  await page.getByLabel('Search identities').fill('visitor');
  await page.getByLabel('Allow ' + guest.matrixUserId, { exact: true }).check();
  await page.getByLabel('Search identities').fill('no-match');
  await expect(page.getByRole('list', { name: 'Selected wake-up identities' })).toContainText(guest.matrixUserId);
  await page.getByRole('button', { name: 'Save wake-up policy' }).click();
  await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled(); await page.reload();
  await expect(page.getByLabel('Wake-up authority')).toHaveValue('selected');
  await expect(page.getByRole('list', { name: 'Selected wake-up identities' })).toContainText(guest.matrixUserId);
  assert.deepEqual(value(services.collection.wakeSenders({ agentId: alpha.agentId })).map(sender => sender.senderPrincipalId), [guest.id]);
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/manage/fleets', '/manage/fleets/' + fleet.id, agentUrl, agentUrl + '/rooms/' + encodeURIComponent(roomId)]) {
      await page.goto(origin + route); await expect(page.locator('h1')).toBeVisible(); await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await checkPaperLayout(page);
      if (route.includes('/rooms/')) await expect(page.getByText('Reply requires native level 0.', { exact: true })).toHaveCSS('display', 'block');
      if (route === '/manage/fleets/' + fleet.id) {
        const roster = page.getByRole('region', { name: 'Agents', exact: true });
        const table = roster.getByRole('table', { name: 'Fleet agents', exact: true });
        await expect(table.getByRole('columnheader')).toHaveText(['Agent', 'Instance', 'Listener', 'Account']);
        await expect(table.locator('tbody tr')).toHaveCount(instances.length);
        await expect(roster.locator('.agent-card, .agent-grid')).toHaveCount(0);
        for (const instance of instances) {
          const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: instance.instanceKey, exact: true }) });
          await expect(row.getByRole('link')).toHaveAttribute('href', '/manage/agents/' + instance.agentId);
          await expect(row.getByRole('link')).toHaveText(instance.instanceKey + ' (' + admin.member.member.displayName + ')');
          await expect(row.getByRole('cell').nth(2)).toHaveText('offline');
          await expect(row.getByRole('cell').nth(3)).toHaveText('active');
        }
      }
      await page.screenshot({ path: join(directory, width + '-' + route.split('/').filter(Boolean).join('-') + '.png'), fullPage: true });
      if (route === '/manage/fleets/' + fleet.id) {
        await page.getByRole('table', { name: 'Fleet agents', exact: true }).locator('a[href="' + agentUrl + '"]').click();
        await expect(page).toHaveURL(origin + agentUrl);
        await expect(page.getByRole('heading', { name: 'Agent details', exact: true })).toBeVisible();
      }
    }
  }
  const otherContext = await browser.newContext(); await otherContext.addCookies([{ name: 'crossfire', value: other.secret, url: origin }]);
  const otherPage = await otherContext.newPage(); await otherPage.goto(origin + '/manage/fleets');
  await expect(otherPage.getByRole('heading', { name: 'No fleets' })).toBeVisible();
  await checkPaperLayout(otherPage);
  assert.equal((await otherPage.request.get(origin + '/api/fleets/' + fleet.id)).status(), 403);
  assert.equal((await otherPage.request.get(origin + '/api/fleets/' + fleet.id + '/messages')).status(), 403);
  await page.goto(origin + '/manage/fleets/' + fleet.id);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Remove fleet grouping' }).click();
  await expect(page.getByRole('heading', { name: 'No fleets' })).toBeVisible();
  await checkPaperLayout(page);
  assert.equal(value(services.directory.agent(alpha.agentId))!.principal.status, 'active');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId }))!.accessMode, 'reply');
  assert.deepEqual(errors, []);
});

test('browser fleet connection map uses management theme, full roster, adaptive geometry and durable accessible selection', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const { fleet, instances } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId);
  const other = await fixture.member('map-visitor');
  const roomIds: string[] = [];
  for (const name of ['Credit review', 'Covenant calculations', 'Downside risk', 'Document sources']) roomIds.push(value(await nativeOk(
    { base: fixture.native.base, token: admin.token }, 'POST', API + '/createRoom', { name, preset: 'private_chat' })).room_id as string);
  for (let index = 0; index < instances.length; index++) {
    const id = instances[index]!.agentId!, principal = value(services.directory.agent(id))!.principal, mode = WAKE_POLICIES[index % WAKE_POLICIES.length]!;
    value(changeWakePolicy(services, admin.actor, id, { expectedRevision: principal.revision, mode, senderIds: mode === 'selected' ? [other.actor.principalId] : [] }, randomUUID()));
    if (index < 12) value(reportListener(services, { kind: 'agent', principalId: id }, id, randomUUID(), { release: 'browser-map', messagesDelivered: 0, stopped: false }, 'browser-map'));
    if (index >= 20) continue;
    const record = value(services.directory.agent(id))!, modeIndex = index % 3;
    value(await changeRoomGrant(services, admin.actor, { agentId: id, roomId: roomIds[index % roomIds.length]!, expectedRevision: record.principal.revision,
      expectedGeneration: null, accessMode: modeIndex === 0 ? 'read' : modeIndex === 1 ? 'reply' : 'custom', powerLevel: modeIndex === 2 ? 25 : null, muted: index % 5 === 0 }, randomUUID()));
  }
  await worker.drain();
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
  scope.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
  await context.addCookies([{ name: 'crossfire', value: admin.secret, url: origin }]);
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = '/manage/fleets/' + fleet.id, route = base + '/map';
  await page.goto(origin + base);
  await page.getByRole('link', { name: 'Connection map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fleet map', exact: true })).toBeVisible();
  await expect(page.locator('.map-node-agent')).toHaveCount(24);
  await expect(page.locator('.map-node-room')).toHaveCount(4);
  await expect(page.locator('.map-node-source')).toHaveCount(6);
  await expect(page.locator('.map-edge')).toHaveCount(44);
  await expect(page.locator('.map-toolbar')).toContainText('24 of 24 agents shown');
  await checkPaperLayout(page);
  assert.equal(await page.evaluate<string>("getComputedStyle(document.querySelector('.shell')).getPropertyValue('--accent').trim()"), '#2f5fe0');
  const first = page.locator('[data-node="agent:' + instances[0]!.agentId + '"]');
  await first.focus(); await first.press('ArrowRight');
  assert.notEqual(await page.locator(':focus').getAttribute('data-node'), await first.getAttribute('data-node'));
  await page.locator(':focus').press('Enter');
  assert(new URL(page.url()).searchParams.get('node'));
  await page.locator(':focus').press('Escape');
  assert.equal(new URL(page.url()).searchParams.get('node'), null);
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const details = page.getByRole('region', { name: 'Connection details', exact: true });
  await expect(details.getByRole('link', { name: 'Agent details →', exact: true })).toHaveAttribute('href', '/manage/agents/' + instances[0]!.agentId);
  await expect(details.getByRole('table', { name: 'Selected room connections' })).toContainText('Credit review');
  await expect(details.getByRole('table', { name: 'Selected room connections' })).toContainText('Muted');
  await expect(page.locator('.map-edge[data-highlighted=true]')).toHaveCount(2);
  const savedUrl = page.url(); await page.reload(); await expect(first).toHaveAttribute('aria-pressed', 'true'); assert.equal(page.url(), savedUrl);
  await page.getByRole('button', { name: 'Select source ' + WAKE_LABELS.everyone, exact: true }).click();
  await expect(details.getByRole('table', { name: 'Wake-up identities' }).locator('tbody tr')).toHaveCount(20);
  await details.getByRole('navigation', { name: 'Pagination', exact: true }).last().getByRole('button', { name: 'Next', exact: true }).click();
  await expect(details.getByRole('table', { name: 'Wake-up identities' }).locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByLabel('Search map').fill('map-worker-23'); await page.getByRole('button', { name: 'Apply search', exact: true }).click();
  await expect(page.locator('.map-node-agent')).toHaveCount(1); await expect(page.locator('.map-node-room')).toHaveCount(0);
  await expect(page.locator('.map-node-source small')).toHaveText('1 agent · 1 chosen');
  await page.locator('.map-node-agent').click(); await expect(details.getByRole('heading', { name: 'No rooms', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click(); await expect(page.locator('.map-node-agent')).toHaveCount(24);
  await page.getByLabel('Listener status').selectOption('online'); await expect(page.locator('.map-node-agent')).toHaveCount(12);
  await page.goBack(); await expect(page.locator('.map-node-agent')).toHaveCount(24);
  await page.getByRole('button', { name: 'Refresh map', exact: true }).click(); await expect(page.locator('.map-node-agent')).toHaveCount(24);
  const directory = mkdtempSync(join(process.cwd(), '.temp/fleet-map-browser-'));
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 1100 }); await page.goto(origin + route);
    await expect(page.locator('.map-node-agent')).toHaveCount(24); await expect(page.getByRole('alert')).toHaveCount(0); await checkPaperLayout(page);
    const geometry = await page.locator('.map-node').evaluateAll(nodes => nodes.map(element => {
      const rectangle = element.getBoundingClientRect(); return { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom };
    }));
    for (let index = 0; index < geometry.length; index++) for (let otherIndex = index + 1; otherIndex < geometry.length; otherIndex++) {
      const first = geometry[index]!, second = geometry[otherIndex]!;
      assert(first.right <= second.left || second.right <= first.left || first.bottom <= second.top || second.bottom <= first.top, 'Map nodes do not overlap');
    }
    if (width === 390) {
      await page.getByRole('button', { name: 'Select room Credit review', exact: true }).click();
      await expect(details.getByRole('table', { name: 'Selected room connections' }).locator('tbody tr')).toHaveCount(5);
    }
    await page.screenshot({ path: join(directory, 'fleet-map-' + width + '.png'), fullPage: true });
  }
  const unauthorized = await browser.newContext(); scope.after(() => unauthorized.close());
  await unauthorized.addCookies([{ name: 'crossfire', value: other.secret, url: origin }]);
  const denied = await unauthorized.newPage(); await denied.goto(origin + route);
  await expect(denied.getByRole('alert')).toBeVisible(); await expect(denied.locator('.map-node')).toHaveCount(0);
  assert.deepEqual(errors, []);
});
