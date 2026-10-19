import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { API } from '@ctlflow/crossfire-adapter-matrix/protocol';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { changeFleet } from '@ctlflow/crossfire-domain/fleet/change-fleet';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { browserOptions } from '@ctlflow/crossfire-test-support/tls';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';

test('real room refresh updates pristine edits and explicitly fences dirty edits after another authorized writer', { timeout: 60000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin } = fixture;
  const agent = await fixture.agent(admin.actor, 'editable');
  const created = value(await nativeOk({ base: fixture.native.base, token: admin.token }, 'POST', API + '/createRoom', { name: 'Editable room', preset: 'private_chat' }));
  assert.equal(typeof created.room_id, 'string'); const roomId = created.room_id as string;
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/manage/agents/' + agent.id);
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Editable room', exact: true }) }), select = row.getByRole('combobox');
  await expect(select).toHaveValue('none');
  async function assign(accessMode: 'read' | 'reply', muted: boolean) {
    const current = value(services.directory.agent(agent.id))!;
    const grant = value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId }));
    value(await changeRoomGrant(services, admin.actor, { agentId: agent.id, roomId, expectedRevision: current.principal.revision,
      expectedGeneration: grant?.generation ?? null, accessMode, nativeAccess: null, muted }, randomUUID()));
    value(await reconcileRoomGrant(services, agent.id, roomId));
  }
  await assign('reply', false);
  await expect(select).toHaveValue('reply', { timeout: 12000 });
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/rooms');
  await page.getByRole('button', { name: 'Refresh rooms', exact: true }).click(); assert.equal((await refresh).status(), 200);
  await expect(select).toHaveValue('reply');
  await select.selectOption('read');
  await assign('reply', true);
  await expect(row.getByRole('alert')).toContainText('changed elsewhere', { timeout: 12000 });
  await expect(select).toHaveValue('read'); await expect(row.getByRole('button', { name: 'Save access' })).toBeDisabled();
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId }))?.muted, true);
  await row.getByRole('button', { name: 'Discard edits & load latest' }).click();
  await expect(select).toHaveValue('reply'); await expect(row.getByRole('checkbox')).toBeChecked();
  await select.selectOption('read');
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes('/room-grants/'));
  await row.getByRole('button', { name: 'Save access' }).click(); assert.equal((await saved).status(), 202);
  await expect(select).toHaveValue('read');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: agent.id, roomId }))?.accessMode, 'read');
  assert.deepEqual(errors, []);
});

test('agent names are registered-only while retained fleet labels fence concurrent dirty edits', { timeout: 60000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin } = fixture;
  const agent = await fixture.agent(admin.actor, 'editable-name');
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  const context = await browser.newContext(); await context.addCookies([{ name: COOKIE_NAME, value: admin.secret, url: origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); await page.goto(origin + '/manage/agents/' + agent.id + '/settings');
  await expect(page.getByRole('heading', { name: 'Registered name', exact: true })).toBeVisible();
  await expect(page.getByLabel('Configured display name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save name', exact: true })).toHaveCount(0);
  await expect(page.getByText('The identity and history stay the same.', { exact: false })).toBeVisible();
  assert.equal(value(services.directory.agent(agent.id))!.name, 'editable-name');
  await page.goto(origin + '/manage/fleets/' + agent.controller.fleetId + '/settings');
  const label = page.getByLabel('Fleet label'); await expect(label).not.toHaveValue('');
  const renameFleet = (label: string) => {
    const fleet = value(services.repositories.fleet.findById(agent.controller.fleetId))!;
    value(changeFleet(services, admin.actor, fleet.id, { expectedRevision: fleet.revision, label, controller: { name: fleet.controllerName } }, randomUUID()));
  };
  renameFleet('Updated fleet'); await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(label).toHaveValue('Updated fleet');
  await label.fill('Unsaved fleet'); renameFleet('Other fleet writer');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere'); await expect(label).toHaveValue('Unsaved fleet');
  await expect(page.getByRole('button', { name: 'Save label' })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard edits & load latest' }).click(); await expect(label).toHaveValue('Other fleet writer');
});
