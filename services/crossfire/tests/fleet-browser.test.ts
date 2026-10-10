import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value, secret } from './support/application.js';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { API } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { mapFleet } from './support/map-fleet.js';
import { changeWakePolicy } from '@ctlflow/crossfire-domain/wake/change-policy';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { WAKE_POLICIES, WAKE_LABELS } from '@ctlflow/crossfire-contracts/wake';
import { elementAssets } from './support/element.js';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { createListenerHost } from '@ctlflow/crossfire-adapter-crossfire/listener-host';
import { fakeCodex, until } from '../scripts/test-support/listener.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { browserOptions } from './support/tls.js';
import { browserController } from './support/browser-controller.js';
import { decideConfirmation } from './support/confirmation.js';

test('browser fleet review, room-plan confirmation, invitation delegation and selected wake identities share canonical APIs', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const directory = mkdtempSync(join(process.cwd(), '.temp/fleet-browser-'));
  const other = await fixture.member('alice'), guest = await fixture.agent(other.actor, 'visitor');
  const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: admin.member.principal.matrixUserId, fleetKey: 'research',
    controller: { name: 'Research workstation', metadata: { site: 'local' } }, instances: [
      { instanceKey: 'alpha', name: 'alpha', coordinationPolicy: { wakeMode: 'selected' as const, senders: [{ matrixUserId: admin.member.principal.matrixUserId, includeAgents: true }], permissions: ['room.agent.invite' as const] } },
      { instanceKey: 'beta', name: 'beta', coordinationPolicy: { ...defaultCoordinationPolicy(admin.member.principal.matrixUserId), wakeMode: 'selected' as const,
        senders: [admin.member.principal.matrixUserId, guest.matrixUserId].map(matrixUserId => ({ matrixUserId, includeAgents: false })) } }] };
  const introduced = value(await introduceEnrollment(services, input));
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const context = await browser.newContext(); await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/manage/enrollments/' + input.enrollmentId);
  await expect(page.getByText('Research workstation', { exact: true })).toBeVisible();
  await expect(page.getByText('alpha', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Enrollment roster' }).getByRole('columnheader')).toHaveText(['Instance', 'Agent name', 'Outcome', 'Who can wake', 'Room coordination', 'Details']);
  await expect(page.getByRole('table', { name: 'Enrollment roster' }).locator('tbody tr').first().getByRole('cell').nth(3)).toContainText(WAKE_LABELS.selected);
  await expect(page.getByText('Remove only its own additions', { exact: true })).toBeVisible();
  await page.getByText('2 selected entries', { exact: true }).click();
  await page.getByText('1 selected entry', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Enrollment roster' })).toContainText(guest.matrixUserId);
  await expect(page.getByRole('table', { name: 'Enrollment roster' })).toContainText(admin.member.principal.matrixUserId);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkPaperLayout(page);
    await page.screenshot({ path: join(directory, 'coordination-review-' + width + '.png'), fullPage: true });
    for (const identity of await page.getByRole('table', { name: 'Enrollment roster' }).locator('li').all()) {
      const bounds = await identity.boundingBox();
      assert(bounds && bounds.width >= 180 && bounds.height <= 60,
        'Selected identities retain readable wrapping: ' + JSON.stringify({ viewport: width, bounds }));
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Verification code').fill(introduced.request.verificationCode);
  await page.getByRole('button', { name: 'Approve roster', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Agent details →' })).toHaveCount(2); await worker.drain();
  const fleet = value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: 'research' }))!;
  const ready = value(exchangeEnrollment(services, input.enrollmentId, input.claimSecret));
  const controller = { fleetId: fleet.id, connectionId: randomUUID(), credential: ready.fleet!.controllerCredential! };
  const controllerActor = value(authenticateController(services, controller.credential));
  value(reportFleetConnection(services, controllerActor, fleet.id, controller.connectionId, false));
  const instances = value(services.collection.fleetInstances({ ownerId: admin.actor.principalId, fleetKey: 'research' }));
  const alpha = instances.find(instance => instance.instanceKey === 'alpha')!;
  const roomId = value(await nativeOk({ base: fixture.native.base, token: admin.token }, 'POST', API + '/createRoom', { name: 'Research', preset: 'private_chat' })).room_id as string;
  const reportTime = services.clock.now();
  const reporting = value(reportListener(services, { kind: 'agent', principalId: alpha.agentId }, alpha.agentId, randomUUID(), {
    release: 'browser', stopped: true, controller, messagesDelivered: 12, statistics: { sequence: 1,
      startedAt: reportTime - 300000, endedAt: reportTime, dropped: 2,
      flows: Array.from({ length: 25 }, (_, index) => ({ roomId, senderMatrixId: admin.member.principal.matrixUserId,
        messageType: 'type-' + index, observed: 1, delivered: 1, contentBytes: 1024, deliveredBytes: 1024, attachmentBytes: 0, largestBytes: 1024 })),
      usage: [{ runtime: 'pi', sessionId: 'browser-pi-history', tokens: { input: 100, cachedInput: 20, cacheWriteInput: 0, output: 30, reasoningOutput: null, total: 130 } }] } }, 'browser'));
  assert(reporting.statisticsAccepted);
  value(reportListener(services, { kind: 'agent', principalId: alpha.agentId }, alpha.agentId, randomUUID(), {
    release: 'browser', stopped: true, controller, messagesDelivered: 0, statistics: { sequence: 1, startedAt: reportTime, endedAt: reportTime + 1,
      dropped: 0, flows: [], usage: [{ runtime: 'pi', sessionId: 'browser-pi-history',
        tokens: { input: 200, cachedInput: 40, cacheWriteInput: 0, output: 60, reasoningOutput: null, total: 260 } }] } }, 'browser'));
  const runtimeCommands: { action: string; agentId: string | null }[] = [];
  const runtimeRuns = new Map<string, string>();
  const control = await browserController(scope, { origin, controller, owner: admin.member.principal.matrixUserId, execute: async command => {
      runtimeCommands.push({ action: command.action, agentId: command.agentId });
      for (const instance of instances) {
        if (command.agentId !== null && command.agentId !== instance.agentId) continue;
        const binding = control.listener(instance.agentId), proof = binding.control.binding(); binding.close();
        const previousId = runtimeRuns.get(instance.agentId);
        const previous = previousId ? value(services.repositories.listenerRun.find({ id: previousId })) : null;
        if (command.action === 'reset' && previous?.stoppedAt === null) value(reportListener(services,
          { kind: 'agent', principalId: instance.agentId }, instance.agentId, previous.id,
          { release: 'browser', controller: proof, stopped: true, messagesDelivered: 0, statistics: null }, 'browser'));
        const runId = command.action === 'stop' ? previousId! : command.action === 'start' && previous?.stoppedAt === null ? previous.id : randomUUID();
        runtimeRuns.set(instance.agentId, runId);
        value(reportListener(services, { kind: 'agent', principalId: instance.agentId }, instance.agentId, runId,
          { release: 'browser', controller: proof, stopped: command.action === 'stop', messagesDelivered: 0, statistics: null }, 'browser'));
      }
      return success({ status: 'succeeded', errorMessage: null });
    } });
  await page.goto(origin + '/manage/fleets');
  await page.getByLabel('Search fleets or controllers').fill('workstation');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Apply filters', exact: true }).click()]);
  await expect(page.getByRole('table', { name: 'Fleets', exact: true }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'research', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Fleet agents', exact: true })).toBeVisible();
  await expect(page.getByLabel('Fleet label')).toHaveCount(0);
  await expect(page.getByLabel('Room plan TOML')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link')).toHaveText(['Agents', 'Map', 'Sessions', 'Activity', 'Settings']);
  await expect(page.getByRole('button', { name: 'Resume sessions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause delivery', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Activity', exact: true }).click();
  const delivery = page.getByRole('region', { name: 'Fleet delivery', exact: true });
  await delivery.getByText('Connection and recovery', { exact: true }).click();
  await expect(delivery.getByText('online', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause delivery' }).click(); await decideConfirmation(page);
  assert.equal(value(services.repositories.fleet.findById(fleet.id))!.deliveryEnabled, true);
  await page.getByRole('button', { name: 'Pause delivery' }).click();
  await Promise.all([page.waitForEvent('load'), decideConfirmation(page, 'Pause delivery')]);
  await expect(page.getByRole('button', { name: 'Resume delivery', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to fleet', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Resume delivery' }).click();
  await Promise.all([page.waitForEvent('load'), decideConfirmation(page, 'Resume delivery')]);
  await expect(page.getByRole('button', { name: 'Pause delivery', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume sessions', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Resume sessions', exact: true }).click();
  try { await expect(page.getByRole('table', { name: 'Session operations', exact: true })).toContainText('succeeded'); }
  catch (error) { scope.diagnostic('Controller session-control status: ' + JSON.stringify(control.status())); throw error; }
  assert.deepEqual(runtimeCommands, [{ action: 'start', agentId: null }], 'Default UI start is resume, not reset');
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Fleet agents', exact: true }).getByText('online', { exact: true })).toHaveCount(2);
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await page.reload();
  await expect(page.getByRole('table', { name: 'Fleet agents', exact: true }).getByText('online', { exact: true })).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Stop sessions', exact: true }).click(); await decideConfirmation(page, 'Stop sessions');
  await until(() => value(services.repositories.fleetRuntimeOperation.page(fleet.id, { page: 1, pageSize: 10 })).items.some(operation => operation.action === 'stop' && operation.agentId === null && operation.status === 'succeeded'));
  await page.clock.fastForward(3001);
  await expect(page.getByRole('table', { name: 'Session operations', exact: true }).locator('tbody tr').filter({ hasText: 'Stop' })).toContainText('succeeded');
  assert.deepEqual(runtimeCommands.at(-1), { action: 'stop', agentId: null });
  await expect(page.getByRole('button', { name: 'Resume sessions', exact: true })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Fleet agents', exact: true }).getByText('offline', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('table', { name: 'Fleet agents', exact: true }).getByText('Stopped', { exact: true })).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Sessions', exact: true }).click();
  await page.clock.resume();
  await page.getByText('Start over with fresh history', { exact: true }).click();
  await page.getByRole('button', { name: 'Start with fresh history', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('replaces their model contexts'); await decideConfirmation(page);
  assert.equal(runtimeCommands.length, 2, 'Cancelling destructive confirmation sends no operation');
  await page.getByRole('button', { name: 'Start with fresh history', exact: true }).click(); await decideConfirmation(page, 'Start with fresh history');
  await expect(page.getByRole('table', { name: 'Session operations', exact: true }).locator('tbody tr').filter({ hasText: 'Fresh history' })).toContainText('succeeded');
  assert.deepEqual(runtimeCommands.at(-1), { action: 'reset', agentId: null });
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await checkPaperLayout(page);
    await page.screenshot({ path: join(directory, 'fleet-sessions-' + width + '.png'), fullPage: true }); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/manage/agents/' + alpha.agentId + '/session');
  await expect(page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link')).toHaveText(['Rooms', 'Session', 'Activity', 'Settings']);
  await expect(page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Session', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeEnabled();
  const agentOperations = page.getByRole('table', { name: 'Session operations', exact: true }).locator('tbody tr').filter({
    has: page.locator('a[href="/manage/agents/' + alpha.agentId + '/session"]') });
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(agentOperations.filter({ hasText: 'Resume' })).toContainText('succeeded');
  assert.deepEqual(runtimeCommands.at(-1), { action: 'start', agentId: alpha.agentId });
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000)); await page.reload();
  await expect(page.locator('.subject-status').getByText('online', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop session', exact: true }).click(); await decideConfirmation(page, 'Stop session');
  await until(() => value(services.repositories.fleetRuntimeOperation.page(fleet.id, { page: 1, pageSize: 10 })).items.some(operation => operation.action === 'stop' && operation.agentId === alpha.agentId && operation.status === 'succeeded'));
  await page.clock.fastForward(3001);
  await expect(agentOperations.filter({ hasText: 'Stop' })).toContainText('succeeded');
  assert.deepEqual(runtimeCommands.at(-1), { action: 'stop', agentId: alpha.agentId });
  await expect(page.locator('.subject-status').getByText('offline', { exact: true })).toBeVisible();
  await page.clock.resume();
  await page.getByText('Start over with fresh history', { exact: true }).click();
  await page.getByRole('button', { name: 'Start with fresh history', exact: true }).click(); await decideConfirmation(page);
  assert.equal(runtimeCommands.length, 5);
  await page.getByRole('button', { name: 'Start with fresh history', exact: true }).click(); await decideConfirmation(page, 'Start with fresh history');
  await expect(agentOperations.filter({ hasText: 'Fresh history' })).toContainText('succeeded');
  assert.deepEqual(runtimeCommands.at(-1), { action: 'reset', agentId: alpha.agentId });
  await page.goto(origin + '/manage/fleets/' + fleet.id + '/activity');
  await page.getByLabel('Message the fleet').fill('Browser-reviewed explicit fleet task');
  await page.getByRole('button', { name: 'Send to fleet', exact: true }).click(); await decideConfirmation(page);
  assert.equal(value(services.repositories.fleetMessage.page(fleet.id, { page: 1, pageSize: 10 })).totalItems, 0);
  await page.getByRole('button', { name: 'Send to fleet', exact: true }).click(); await decideConfirmation(page, 'Send to fleet');
  await expect(page.getByRole('table', { name: 'Fleet messages', exact: true })).toContainText('Browser-reviewed explicit fleet task');
  await expect(page.getByRole('table', { name: 'Fleet messages', exact: true }).locator('tbody tr').first().getByRole('cell').nth(4)).toHaveText('2', { timeout: 10000 });
  const longMessage = 'Paginated fleet task 0: ' + 'Exact preserved task content. '.repeat(80);
  for (let index = 0; index < 10; index++) value(await control.message({ messageId: randomUUID(), body: index === 0 ? longMessage : 'Paginated fleet task ' + index }));
  await page.reload();
  const history = page.getByRole('region', { name: 'Fleet messages', exact: true });
  await expect(history.locator('tbody tr')).toHaveCount(10);
  const messagePreview = history.locator('.fleet-message-preview');
  await expect(messagePreview).toHaveCount(1);
  await expect(messagePreview.locator('summary')).toContainText('Paginated fleet task 0:');
  await expect(messagePreview.locator('p')).toBeHidden();
  await messagePreview.locator('summary').click();
  await expect(messagePreview.locator('p')).toHaveText(longMessage);
  assert.equal(await messagePreview.locator('p').textContent(), longMessage);
  await expect(messagePreview.locator('p')).toBeVisible();
  await messagePreview.locator('summary').click();
  await history.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(origin + '/manage/fleets/' + fleet.id + '/activity?messagesPage=2');
  await expect(history.locator('tbody tr')).toHaveCount(1);
  await expect(history.getByRole('table')).toContainText('Browser-reviewed explicit fleet task');
  await history.getByRole('link', { name: 'Previous' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Fleet label')).toHaveValue('research');
  await page.getByLabel('Fleet label').fill('Research team');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save label' }).click()]);
  await expect(page.getByLabel('Fleet label')).toHaveValue('Research team');
  const toml = 'fleet = "research"\n[[agents]]\ninstance = "alpha"\n[[agents.grants]]\nroom = ' + JSON.stringify(roomId) + '\naccess = "reply"\nmuted = false\n';
  await page.getByText('Bulk room access (advanced)', { exact: true }).click();
  await page.getByLabel('Room plan TOML').fill(toml);
  await page.getByRole('button', { name: 'Preview room access' }).click();
  const plan = page.getByRole('region', { name: 'Room plan', exact: true });
  await expect(plan.getByRole('link', { name: 'Research', exact: true })).toBeVisible();
  await expect(plan.getByText('Change access', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply reviewed plan' }).click();
  await decideConfirmation(page);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId })), null);
  await page.getByRole('button', { name: 'Apply reviewed plan' }).click();
  await Promise.all([page.waitForEvent('load'), decideConfirmation(page, 'Apply reviewed plan')]);
  await worker.drain();
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId }))!.accessMode, 'reply');
  const agentUrl = '/manage/agents/' + alpha.agentId;
  await page.goto(origin + agentUrl + '/rooms/' + encodeURIComponent(roomId));
  await expect(page.getByLabel('Allow this agent to invite other registered agents')).toBeChecked();
  await page.getByLabel('Allow this agent to invite other registered agents').uncheck();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save invitation permission' }).click()]);
  await expect(page.getByLabel('Allow this agent to invite other registered agents')).not.toBeChecked();
  await page.getByLabel('Allow this agent to invite other registered agents').check();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save invitation permission' }).click()]);
  await expect(page.getByLabel('Allow this agent to invite other registered agents')).toBeChecked();
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: alpha.agentId, roomId })).map(permission => permission.permissionCode), ['room.agent.invite']);
  await page.goto(origin + agentUrl);
  await page.getByRole('link', { name: 'Choose who can wake' }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByLabel('Show', { exact: true }).selectOption('agent');
  await page.getByLabel('Search people or Matrix IDs').fill('visitor');
  await page.getByLabel('Allow ' + guest.matrixUserId, { exact: true }).check();
  await page.getByLabel('Search people or Matrix IDs').fill('no-match');
  await expect(page.getByRole('table', { name: 'Selected wake-up people and agents' })).toContainText(guest.matrixUserId);
  await page.getByRole('button', { name: 'Save wake-up policy' }).click();
  await expect(page).toHaveURL(origin + agentUrl); await page.reload();
  await expect(page.getByRole('table', { name: 'Selected wake-up people and agents' })).toContainText(guest.matrixUserId);
  assert.deepEqual(value(services.collection.wakeSenders({ agentId: alpha.agentId })).map(sender => sender.senderPrincipalId), [guest.id]);
  await page.goto(origin + '/manage/fleets/' + fleet.id + '/activity');
  await page.getByRole('navigation', { name: 'Fleet activity' }).getByRole('link', { name: 'Traffic & usage', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Message flows', exact: true }).locator('tbody tr')).toHaveCount(20);
  await expect(page.getByRole('region', { name: 'Traffic', exact: true })).toContainText('25');
  await expect(page.getByRole('region', { name: 'Native usage', exact: true })).toContainText('Not reported by this runtime');
  await expect(page.getByRole('region', { name: 'Native usage', exact: true })).toContainText('100');
  await expect(page.getByRole('region', { name: 'Native usage', exact: true }).locator('dt').filter({ hasText: /^Reasoning output$/u })
    .locator('xpath=following-sibling::dd[1]')).toHaveText('Not reported');
  await page.getByRole('region', { name: 'Sender → recipient', exact: true }).getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(origin + '/manage/fleets/' + fleet.id + '/activity?view=traffic&page=2');
  await expect(page.getByRole('table', { name: 'Message flows', exact: true }).locator('tbody tr')).toHaveCount(5);
  await page.getByLabel('Period', { exact: true }).selectOption('168');
  await expect(page).toHaveURL(origin + '/manage/fleets/' + fleet.id + '/activity?view=traffic&hours=168');
  assert.equal((await page.request.get(origin + '/api/fleets/' + fleet.id + '/statistics?hours=0')).status(), 400);
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/manage/fleets', '/manage/fleets/' + fleet.id, ...['activity', 'activity?view=traffic', 'settings'].map(section => '/manage/fleets/' + fleet.id + '/' + section), agentUrl, ...['session', 'activity', 'settings'].map(section => agentUrl + '/' + section), agentUrl + '/rooms/' + encodeURIComponent(roomId)]) {
      await page.goto(origin + route); await expect(page.locator('h1')).toBeVisible(); await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await checkPaperLayout(page);
      if (route.includes('/rooms/')) await expect(page.getByText('Reply requires native level 0.', { exact: true })).toHaveCSS('display', 'block');
      if (route === '/manage/fleets/' + fleet.id) {
        const roster = page.getByRole('region', { name: 'Agents', exact: true });
        const table = roster.getByRole('table', { name: 'Fleet agents', exact: true });
        await expect(table.getByRole('columnheader')).toHaveText(['Agent', 'Instance', 'Listener', 'Native session', 'Account']);
        await expect(table.locator('tbody tr')).toHaveCount(instances.length);
        await expect(roster.locator('.agent-card, .agent-grid')).toHaveCount(0);
        for (const instance of instances) {
          const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: instance.instanceKey, exact: true }) });
          await expect(row.getByRole('link')).toHaveAttribute('href', '/manage/agents/' + instance.agentId);
          await expect(row.getByRole('link')).toHaveText(instance.instanceKey + ' (' + admin.member.member.displayName + ')');
          await expect(row.getByRole('cell').nth(2)).toHaveText('online');
          await expect(row.getByRole('cell').nth(3)).toHaveText('UnknownNo native observation');
          await expect(row.getByRole('cell').nth(4)).toHaveText('active');
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
  const otherContext = await browser.newContext(); await otherContext.addCookies([{ name: COOKIE_NAME, value: other.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const otherPage = await otherContext.newPage(); await otherPage.goto(origin + '/manage/fleets');
  await expect(otherPage.getByRole('table', { name: 'Fleets', exact: true })).not.toContainText('Research team');
  await checkPaperLayout(otherPage);
  assert.equal((await otherPage.request.get(origin + '/api/fleets/' + fleet.id)).status(), 403);
  assert.equal((await otherPage.request.get(origin + '/api/fleets/' + fleet.id + '/messages')).status(), 403);
  assert.equal((await otherPage.request.get(origin + '/api/fleets/' + fleet.id + '/statistics')).status(), 403);
  await page.goto(origin + '/manage/fleets/' + fleet.id + '/settings');
  await expect(page.getByRole('button', { name: 'Remove fleet grouping' })).toHaveCount(0);
  for (const route of ['/manage/connect/fleet', ...['delivery', 'messages', 'statistics', 'rooms'].map(section => '/manage/fleets/' + fleet.id + '/' + section), ...['runtime', 'sessions', 'decisions', 'software'].map(section => '/manage/agents/' + alpha.agentId + '/' + section)]) {
    await page.goto(origin + route);
    await expect(page.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible();
  }
  await checkPaperLayout(page);
  assert.equal(value(services.directory.agent(alpha.agentId))!.principal.status, 'active');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: alpha.agentId, roomId }))!.accessMode, 'reply');
  assert.deepEqual(errors, []);
});

test('stock Element room invite search finds an agent with no shared rooms without admitting it', { timeout: 120000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/element-directory-'));
  const fixture = await nativeServer(scope, await releaseFixture(), {}, elementAssets());
  const owner = await fixture.member('alice'), other = await fixture.member('bob'), agent = await fixture.agent(other.actor, 'bea');
  const room = value(await nativeOk({ base: fixture.origin, token: owner.token }, 'POST', API + '/createRoom', { name: 'Matter review', preset: 'private_chat' }));
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto(fixture.origin + '/#/login');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(owner.accepted.account.userId);
  await page.getByLabel('Password', { exact: true }).fill(owner.input.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const keys = page.getByRole('dialog', { name: 'Setting up keys', exact: true }).filter({ has: page.getByRole('textbox', { name: 'Password', exact: true }) });
  await keys.getByRole('textbox', { name: 'Password', exact: true }).fill(owner.input.password);
  await keys.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.mx_LeftPanel')).toBeVisible({ timeout: 30000 });
  await page.goto(fixture.origin + '/#/room/' + room.room_id);
  await expect(page.locator('.mx_RoomHeader')).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: join(directory, 'native-room-before-invite.png'), fullPage: true });
  await page.getByRole('button', { name: /Invite.*room/u }).click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('textbox');
  const searched = page.waitForResponse(response => response.url().endsWith('/_matrix/client/v3/user_directory/search') && response.request().method() === 'POST');
  await search.fill('bea');
  const response = await searched;
  assert.equal(response.status(), 200);
  await expect(dialog.getByText('bea (bob)', { exact: true })).toBeVisible();
  await expect(dialog.getByText(agent.matrixUserId, { exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory, 'native-invite-zero-room.png'), fullPage: true });
  assert.equal(value(fixture.services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  assert.deepEqual(value(await fixture.services.matrix.joined(agent.matrixUserId)), []);
  assert.deepEqual(value(fixture.services.collection.roomGrants({ agentId: agent.id })), []);
  assert.equal(value(await fixture.services.matrix.membership(owner.accepted.account.userId, agent.matrixUserId, String(room.room_id))).membership, 'leave');
});

test('stock Element owner invitations and DMs enable read-and-reply access without management steps', { timeout: 120000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/element-invitations-')), release = await releaseFixture();
  const fixture = await nativeServer(scope, release, {}, elementAssets()), { services, origin } = fixture;
  const owner = await fixture.member('alice'), agent = await fixture.agent(owner.actor, 'ada');
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  const created = value(await nativeOk({ base: origin, token: owner.token }, 'POST', API + '/createRoom', { name: 'Samosas', preset: 'private_chat' }));
  assert(typeof created.room_id === 'string');
  const roomId = created.room_id, runtime = await fakeCodex(scope), stop = new AbortController();
  const host = await createListenerHost(); cleanup(scope, () => host.close());
  const controller = await browserController(scope, { origin, controller: agent.controller, owner: owner.accepted.account.userId,
    execute: async () => failure('invalid', 'This invitation fixture does not execute native lifecycle operations') });
  const binding = controller.listener(agent.id);
  let ended: unknown;
  const receiver = listen({ binding: 'fixture', host, control: binding.control, coordination: createCoordination({ origin, token: agent.token }), settings: {
    instance: 'tests', server_name: 'architecture.localhost', homeserver: origin, owner: owner.accepted.account.userId, max_upload_bytes: 1024 },
    account: { user_id: agent.matrixUserId, access_token: agent.token, device_id: 'CROSSFIRE_AGENT' },
    id: agent.id, release: release.manifest, cursorFile: join(runtime.directory, 'cursor.json'),
    limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 10000, runtime: runtime.runtime,
  }, stop.signal).catch(error => { ended = error; });
  cleanup(scope, async () => { stop.abort(); await receiver; binding.close(); });
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto(origin + '/#/login');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(owner.accepted.account.userId);
  await page.getByLabel('Password', { exact: true }).fill(owner.input.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const keys = page.getByRole('dialog', { name: 'Setting up keys', exact: true }).filter({ has: page.getByRole('textbox', { name: 'Password', exact: true }) });
  await keys.getByRole('textbox', { name: 'Password', exact: true }).fill(owner.input.password);
  await keys.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.mx_LeftPanel')).toBeVisible({ timeout: 30000 });
  await page.goto(origin + '/#/room/' + roomId);
  await expect(page.locator('.mx_RoomHeader')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /Invite.*room/u }).click();
  const invitation = page.getByRole('dialog', { name: 'Invite to Samosas', exact: true });
  await invitation.getByRole('textbox').fill('ada');
  await invitation.getByText('ada (alice)', { exact: true }).click();
  await invitation.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(invitation).toBeHidden();
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Invite new contacts to this room?', exact: true }) });
  await confirmation.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const joined = (room: string) => value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId: room }))?.membership === 'join';
  await until(() => joined(roomId) || ended !== undefined, 'Element invitation did not admit the owned agent', 30000);
  assert.equal(ended, undefined);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId }))?.accessMode, 'reply');
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 0);
  await page.screenshot({ path: join(directory, 'element-owner-room-admitted.png'), fullPage: true });

  const createdDirectRooms: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/createRoom')) createdDirectRooms.push(request.url()); });
  await page.goto(origin + '/#/user/' + agent.matrixUserId);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const composer = page.getByRole('region', { name: 'Message composer', exact: true }).getByRole('textbox');
  await composer.fill('Ada, this is your owner’s direct message.');
  const published = page.waitForResponse(response => response.request().method() === 'PUT'
    && decodeURIComponent(new URL(response.url()).pathname).includes('/send/m.room.message/'));
  await composer.press('Enter');
  assert.equal((await published).status(), 200);
  assert.equal(createdDirectRooms.length, 1, 'Element creates the first owner DM only when the human opens it');
  await page.screenshot({ path: join(directory, 'element-owner-dm-created.png'), fullPage: true });
  await until(() => value(services.repositories.ownerConversation.find({ agentId: agent.id })) !== null || ended !== undefined, 'Element DM did not bind its private owner channel', 30000);
  assert.equal(ended, undefined);
  const conversation = value(services.repositories.ownerConversation.find({ agentId: agent.id }))!;
  await expect(page).toHaveURL(origin + '/#/room/' + conversation.roomId);
  await until(() => joined(conversation.roomId) || ended !== undefined, 'Element DM did not admit the owned agent', 30000);
  await until(() => JSON.stringify(runtime.requests()).includes('Ada, this is your owner’s direct message.') || ended !== undefined, 'Element DM task was not delivered', 30000);
  assert.equal(ended, undefined);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId: conversation.roomId }))?.accessMode, 'reply');
  assert.equal(value(services.repositories.roomGrantApplication.find({ agentId: agent.id, roomId: conversation.roomId }))?.creator, true);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id }))!.roomId, conversation.roomId);
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 1);
  await page.screenshot({ path: join(directory, 'element-owner-dm-admitted.png'), fullPage: true });
  await context.addCookies([{ name: COOKIE_NAME, value: owner.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(origin + '/manage/agents/' + agent.id);
  await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Samosas', exact: true }) }).getByRole('cell').nth(2)).toHaveText('Read & reply');
  const directRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'ada (alice)', exact: true }) });
  await expect(directRow.getByText('Owner DM · always available', { exact: true })).toBeVisible();
  await expect(directRow.getByRole('combobox')).toHaveCount(0);
  await expect(directRow.getByRole('button', { name: 'Save access' })).toHaveCount(0);
  await expect(directRow.getByRole('checkbox')).toHaveCount(0);
  await directRow.getByRole('link', { name: 'ada (alice)', exact: true }).click();
  await expect(page.getByText('Owner DMs stay private between this agent and its owner. Invitation delegation is not available.', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory, 'management-invited-access.png'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('browser fleet connection map uses management theme, full roster, adaptive geometry and durable accessible selection', { timeout: 120000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const { fleet, instances, controller } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId);
  const control = await browserController(scope, { origin, controller, owner: admin.member.principal.matrixUserId,
    execute: async () => failure('unavailable', 'This map fixture has no native lifecycle executor') });
  for (const instance of [instances[0]!, instances.at(-1)!]) value(await connectOwnerConversation(services,
    { kind: 'agent', principalId: instance.agentId! }, instance.agentId!));
  const other = await fixture.member('map-visitor');
  const roomIds: string[] = [];
  for (const name of ['Credit review', 'Covenant calculations', 'Downside risk', 'Document sources']) roomIds.push(value(await nativeOk(
    { base: fixture.native.base, token: admin.token }, 'POST', API + '/createRoom', { name, preset: 'private_chat' })).room_id as string);
  for (let index = 0; index < instances.length; index++) {
    const id = instances[index]!.agentId!, principal = value(services.directory.agent(id))!.principal, mode = WAKE_POLICIES[index % WAKE_POLICIES.length]!;
    value(changeWakePolicy(services, admin.actor, id, { expectedRevision: principal.revision, mode, senders: mode === 'selected' ? [other.actor.principalId].map(principalId => ({ principalId, includeAgents: false })) : [] }, randomUUID()));
    if (index < 12) {
      const binding = control.listener(id), proof = binding.control.binding(); binding.close();
      value(reportListener(services, { kind: 'agent', principalId: id }, id, randomUUID(),
        { statistics: null, release: 'browser-map', messagesDelivered: 0, controller: proof, stopped: false }, 'browser-map'));
    }
    if (index >= 20) continue;
    const record = value(services.directory.agent(id))!, modeIndex = index % 3;
    value(await changeRoomGrant(services, admin.actor, { agentId: id, roomId: roomIds[index % roomIds.length]!, expectedRevision: record.principal.revision,
      expectedGeneration: null, accessMode: modeIndex === 0 ? 'read' : modeIndex === 1 ? 'reply' : 'custom', powerLevel: modeIndex === 2 ? 25 : null, muted: index % 5 === 0 }, randomUUID()));
  }
  await worker.drain();
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = '/manage/fleets/' + fleet.id, route = base + '/map';
  await page.goto(origin + base);
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fleet map', exact: true })).toBeVisible();
  await expect(page.locator('.map-node-agent')).toHaveCount(24);
  await expect(page.locator('.map-node-room')).toHaveCount(6);
  await expect(page.locator('.map-node-source')).toHaveCount(3);
  await expect(page.locator('.map-edge')).toHaveCount(46);
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
  await expect(page.locator('.map-edge[data-highlighted=true]')).toHaveCount(3);
  const savedUrl = page.url(); await page.reload(); await expect(first).toHaveAttribute('aria-pressed', 'true'); assert.equal(page.url(), savedUrl);
  await page.getByRole('button', { name: 'Select source ' + WAKE_LABELS.everyone, exact: true }).click();
  await expect(details.getByRole('table', { name: 'Wake-up identities' }).locator('tbody tr')).toHaveCount(20);
  await details.getByRole('navigation', { name: 'Pagination', exact: true }).last().getByRole('button', { name: 'Next', exact: true }).click();
  await expect(details.getByRole('table', { name: 'Wake-up identities' }).locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByLabel('Search map').fill('map-worker-23'); await page.getByRole('button', { name: 'Apply search', exact: true }).click();
  await expect(page.locator('.map-node-agent')).toHaveCount(1); await expect(page.locator('.map-node-room')).toHaveCount(1);
  await expect(page.locator('.map-node-source small')).toHaveText('1 agent');
  await page.locator('.map-node-agent').click(); await expect(details.getByRole('table', { name: 'Selected room connections' }).locator('tbody tr')).toHaveCount(1);
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
  const unauthorized = await browser.newContext(); cleanup(scope, () => unauthorized.close());
  await unauthorized.addCookies([{ name: COOKIE_NAME, value: other.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const denied = await unauthorized.newPage(); await denied.goto(origin + route);
  await expect(denied.getByRole('alert')).toBeVisible(); await expect(denied.locator('.map-node')).toHaveCount(0);
  assert.deepEqual(errors, []);
});
