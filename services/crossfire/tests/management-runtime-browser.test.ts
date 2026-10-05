import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { createFleetControlConnection } from '@ctlflow/crossfire-adapter-crossfire/fleet-control';
import { authenticateController } from '@ctlflow/crossfire-domain/fleet/authority';
import { reportFleetConnection } from '@ctlflow/crossfire-domain/fleet/control';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { browserOptions } from './support/tls.js';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { nativeServer } from './support/native-server.js';
import { mapFleet } from './support/map-fleet.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { until } from '../scripts/test-support/listener.js';

test('Management distinguishes native sleep and wake from listener readiness without per-agent runtime requests', { timeout: 120000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release), { services, admin, origin } = fixture;
  const { fleet, instances, ready, controller } = await mapFleet(services, admin.actor, admin.member.principal.matrixUserId, 3);
  const unreported = await fixture.agent(admin.actor, 'unreported');
  value(reportFleetConnection(services, value(authenticateController(services, controller.credential)), fleet.id, controller.connectionId, true));
  const liveController = createFleetControlConnection({ origin, credential: controller.credential, fleetId: fleet.id,
    owner: admin.member.principal.matrixUserId, signal: new AbortController().signal, acknowledged: () => success(undefined),
    execute: async () => failure('unavailable', 'This observation fixture has no native lifecycle executor') });
  cleanup(scope, () => liveController.close());
  await until(() => liveController.status().connected);
  const tokens = instances.map(instance => {
    const token = ready.instances.find(item => item.instanceKey === instance.instanceKey)?.account?.accessToken; assert(token);
    return createClient({ origin, token });
  });
  const runs = instances.map(() => randomUUID()), observedAt = services.clock.now(), lastActivityAt = observedAt - 60000;
  for (const [index, instance] of instances.entries()) {
    const client = tokens[index]!, agentId = instance.agentId!;
    const binding = liveController.listener(agentId), proof = binding.control.binding(); binding.close();
    value(await client.call(operations.reportListener, { agentId, runId: runs[index]! }, { release: release.manifest.release,
      stopped: false, controller: proof, messagesDelivered: 0, statistics: null }));
    value(await client.call(operations.reportRuntime, { agentId, runId: runs[index]! }, { sessionId: 'native-history-' + index,
      roomId: null, runtime: 'codex', state: index === 0 ? 'sleeping' : index === 1 ? 'waking' : 'idle', observedAt,
      lastActivityAt: index === 2 ? null : lastActivityAt, historyAvailable: index === 2 ? null : true,
      historyMode: 'shared', maxInputBytes: 65536, errorMessage: null,
      settings: [{ name: 'model', configured: 'fixture-model', effective: 'fixture-model' }] }));
    if (index === 2) value(await client.call(operations.reportListener, { agentId, runId: runs[index]! }, { release: release.manifest.release,
      stopped: true, controller: proof, messagesDelivered: 0, statistics: null }));
  }
  mkdirSync('.temp', { recursive: true }); const directory = mkdtempSync(join(process.cwd(), '.temp/native-state-browser-'));
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = [], runtimeRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/runtime-observations')) runtimeRequests.push(request.url()); });
  await page.goto(origin + '/manage/agents');
  const agents = page.getByRole('table', { name: 'Agents', exact: true });
  await expect(agents.getByRole('columnheader', { name: 'Native session', exact: true })).toBeVisible();
  const sleeping = agents.getByRole('row').filter({ has: page.locator('a[href="/manage/agents/' + instances[0]!.agentId + '"]') });
  await expect(sleeping.getByText('online', { exact: true })).toBeVisible(); await expect(sleeping.getByText('Sleeping', { exact: true })).toBeVisible();
  await expect(sleeping).toContainText('Available for resume');
  const unknown = agents.getByRole('row').filter({ has: page.locator('a[href="/manage/agents/' + unreported.id + '"]') });
  await expect(unknown.getByText('Unknown', { exact: true })).toBeVisible();
  assert.deepEqual(runtimeRequests, [], 'The agent list consumes its batched native summary, not N+1 context endpoints');
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'native-agents-desktop.png'), fullPage: true });
  await page.goto(origin + '/manage/fleets/' + fleet.id);
  const roster = page.getByRole('table', { name: 'Fleet agents', exact: true }); await expect(roster.locator('tbody tr')).toHaveCount(3);
  await expect(roster.getByText('Sleeping', { exact: true })).toBeVisible(); await expect(roster.getByText('Waking', { exact: true })).toBeVisible();
  const offline = roster.getByRole('row').filter({ has: page.getByRole('cell', { name: instances[2]!.instanceKey, exact: true }) });
  await expect(offline.getByText('offline', { exact: true })).toBeVisible(); await expect(offline.getByText('Idle', { exact: true })).toBeVisible();
  await expect(offline).toContainText('Last reported'); await expect(offline.getByText('Sleeping', { exact: true })).toHaveCount(0);
  await expect(offline).toContainText('History not reported');
  assert.deepEqual(runtimeRequests, [], 'Fleet roster consumes the same page-batched native summary');
  await checkPaperLayout(page); await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'native-fleet-mobile.png'), fullPage: true });
  const agentId = instances[0]!.agentId!, agentPath = '/manage/agents/' + agentId;
  await page.goto(origin + agentPath + '/session');
  await expect(page.getByRole('region', { name: 'Agent session', exact: true })).toContainText('Available for resume');
  await expect(page.getByRole('region', { name: 'Agent session', exact: true })).toContainText('Sleeping');
  await expect(page.getByRole('table', { name: 'Runtime settings', exact: true })).toContainText('fixture-model');
  await expect(page.getByRole('region', { name: 'Runtime settings', exact: true })).toContainText('Available for resume');
  await expect(page.getByRole('region', { name: 'Runtime settings', exact: true })).toContainText('Last activity');
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'native-runtime-mobile.png'), fullPage: true });
  await page.goto(origin + '/manage/agents/' + instances[2]!.agentId + '/session');
  await expect(page.getByRole('region', { name: 'Runtime settings', exact: true })).toContainText('not proof that the process is running');
  await expect(page.getByRole('region', { name: 'Runtime settings', exact: true }).locator('dt').filter({ hasText: /^Saved history$/u })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Runtime settings', exact: true }).locator('dd').filter({ hasText: /^Not reported$/u })).toHaveCount(2);
  await page.goto(origin + '/manage/agents/' + unreported.id + '/session');
  await expect(page.getByRole('region', { name: 'Agent session', exact: true })).toContainText('Not reported');
  await expect(page.getByRole('heading', { name: 'No native observation yet', exact: true })).toBeVisible();
  assert.deepEqual(errors, []); scope.diagnostic('Real API browser screenshots: ' + directory);
});
