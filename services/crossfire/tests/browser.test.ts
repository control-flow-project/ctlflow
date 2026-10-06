import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { conduitFixture } from '../scripts/architecture-proof/conduit-fixture.js';
import { bootstrap } from '../apps/server/src/bootstrap.js';
import { secret, value } from './support/application.js';
import { createApplication } from '../apps/server/src/composition.js';


import { createWorker } from '../apps/server/src/worker.js';
import { createHttpServer } from '../apps/server/src/http/create-server.js';
import { COOKIE_NAME } from '../apps/server/src/http/transport.js';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { authenticateMember } from '@ctlflow/crossfire-domain/session/authenticate';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { publicRouter } from '../apps/server/src/router.js';
import { releaseFixture, updatedRelease } from './release-fixture.js';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { createFleetControlConnection } from '@ctlflow/crossfire-adapter-crossfire/fleet-control';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { connectCodex } from '@ctlflow/crossfire-adapter-codex/connection';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { createListenerHost } from '@ctlflow/crossfire-adapter-crossfire/listener-host';
import { until } from '../scripts/test-support/listener.js';
import { onboardingUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { checkEnrollmentInstructions, reviewLayouts } from './support/connect-browser.js';
import { checkPaperLayout } from '../tools/browser/layout.js';
import { elementAssets } from './support/element.js';
import { checkOnboardingPolicy } from './support/onboarding-browser.js';
import { browserOptions, secureRouter } from './support/tls.js';

test('paper table checks center complete content groups and reject displaced controls', async scope => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  cleanup(scope, () => browser.close());
  const page = await browser.newPage();
  const style = readFileSync(new URL('../../apps/web/src/style.css', import.meta.url), 'utf8');
  await page.setContent(`<main class="content"><div class="page-frame">
    <header class="page-heading"><h1>Room access</h1></header><div class="page-body">
    <div class="table-wrap"><table><tbody><tr>
      <td><strong>Owner’s direct message</strong><span class="subline">Room identity</span></td>
      <td><select aria-label="Access"><option>Read &amp; reply</option></select></td>
      <td class="captioned-status"><span class="status">Read &amp; reply</span><span class="subline">Native room creator</span></td>
      <td class="standalone-status"><span class="status">Applied</span></td>
      <td><div class="actions"><button>Save access</button></div></td>
      <td><span class="status">Applied</span><details><summary>Provenance</summary><p>Collapsed content does not contribute visible geometry.</p></details></td><td></td>
    </tr></tbody></table></div></div></div></main>`);
  await page.addStyleTag({ content: style });
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await scope.test('centered status caption, closed disclosure and empty cell at ' + width, async () => {
      await checkPaperLayout(page);
      const offset = await page.locator('.captioned-status').evaluate(cell => {
        const outer = cell.getBoundingClientRect(), badge = cell.querySelector('.status')!.getBoundingClientRect();
        return Math.abs((badge.top + badge.bottom - outer.top - outer.bottom) / 2);
      });
      assert(offset > 1, 'A caption places its badge above the centered content group');
    });
    await scope.test('top-aligned cell is rejected at ' + width, async () => {
      await page.locator('td').first().evaluate(cell => { cell.style.verticalAlign = 'top'; });
      await assert.rejects(checkPaperLayout(page), /Every table cell uses one vertical alignment/u);
      await page.locator('td').first().evaluate(cell => { cell.style.verticalAlign = ''; });
    });
    await scope.test('form margin is rejected at ' + width, async () => {
      await page.locator('select').evaluate(control => { control.style.marginTop = '12px'; });
      await assert.rejects(checkPaperLayout(page), /Table controls do not carry surrounding form margins/u);
      await page.locator('select').evaluate(control => { control.style.marginTop = ''; });
    });
    await scope.test('displaced standalone status is rejected at ' + width, async () => {
      await page.locator('.standalone-status .status').evaluate(control => { control.style.transform = 'translateY(12px)'; });
      await assert.rejects(checkPaperLayout(page), /Table content shares the row’s vertical center/u);
      await page.locator('.standalone-status .status').evaluate(control => { control.style.transform = ''; });
      await checkPaperLayout(page);
    });
  }
});

async function submit(page: Page, name: string): Promise<void> {
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name, exact: true }).click()]);
}


test('real browser member/admin flows and a fleet-managed listener span native Conduit, SQLite and owned Codex WS', { timeout: 180_000 }, async scope => {
  const element = elementAssets();
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/browser-'));
  const jwtSecret = secret();
  const matrix = await conduitFixture(scope, { jwtSecret });
  const config = { instance: 'browser', serverName: 'architecture.localhost', publicOrigin: 'http://127.0.0.1',
    contentOrigin: 'http://localhost', matrixOrigin: matrix.base, administrator: '@admin:architecture.localhost', registrationSecret: matrix.registrationToken, jwtSecret };
  const password = secret();
  const initialized = await bootstrap(config, { servicePassword: secret(), administratorPassword: password });
  assert(initialized.ok, JSON.stringify(initialized));
  const application = createApplication(join(directory, 'management.sqlite'), config), { services } = application;
  const worker = createWorker(services);
  const release = await releaseFixture();
  const service = createHttpServer(application, worker, release);
  service.listen(0, '127.0.0.1'); await once(service, 'listening');
  const address = service.address(); assert(address && typeof address === 'object');
  const routes = { publicOrigin: config.publicOrigin, matrixOrigin: matrix.base, serviceOrigin: 'http://127.0.0.1:' + address.port,
    web: join(process.cwd(), 'dist/web'), element };
  cleanup(scope, async () => { await worker.stop(); service.closeAllConnections();
    await new Promise<void>(resolve => service.close(() => resolve())); application.close(); });
  const { origin } = await secureRouter(scope, publicRouter(routes));
  routes.publicOrigin = origin; config.publicOrigin = origin; services.instance.publicOrigin = origin;
  const browser = await chromium.launch(browserOptions);
  cleanup(scope, () => browser.close());
  const errors: string[] = [];
  const identityReads: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/principals') identityReads.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin + '/manage/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'login.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await checkPaperLayout(page);
  await page.getByLabel('Matrix username').focus();
  await expect(page.getByLabel('Matrix username')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.screenshot({ path: join(directory, 'login-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Matrix username').fill(config.administrator);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'login-error.png'), fullPage: true });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No matching agents', exact: true })).toBeVisible();
  await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'agents-empty.png'), fullPage: true });
  const instructions = await checkEnrollmentInstructions(page, origin, config.administrator);
  assert(!instructions.includes(password));
  assert(!instructions.includes(jwtSecret));
  await page.screenshot({ path: join(directory, 'connect-admin.png'), fullPage: true });
  const loggedIn = await nativeOk({ base: origin }, 'POST', API + '/login', { type: 'm.login.password',
    identifier: { type: 'm.id.user', user: config.administrator }, password });
  assert(loggedIn.ok && typeof loggedIn.value.access_token === 'string');
  const human = { base: origin, token: loggedIn.value.access_token };
  const created = value(await nativeOk(human, 'POST', API + '/createRoom', {
    name: 'Engineering', preset: 'private_chat', visibility: 'private',
    initial_state: [{ type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } }],
  }));
  assert(typeof created.room_id === 'string');
  const room = created.room_id;
  const roomAlias = '#engineering' + 'w'.repeat(80) + ':architecture.localhost';
  assert((await nativeOk(human, 'PUT', API + '/directory/room/' + segment(roomAlias), { room_id: room })).ok);
  assert((await nativeOk(human, 'PUT', API + '/rooms/' + segment(room) + '/state/m.room.canonical_alias', { alias: roomAlias })).ok);
  const workspace = join(directory, 'project'); mkdirSync(workspace);
  const stateDirectory = join(directory, 'controller-state'); mkdirSync(stateDirectory);
  const enrollment = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId: config.administrator, fleetKey: 'project',
    controller: { name: 'Browser workstation', metadata: {} }, instances: [{ instanceKey: 'holmes', name: 'holmes',
      coordinationPolicy: { ...defaultCoordinationPolicy(), wakeMode: 'owner' as const } }] };
  const introduced = value(await introduceEnrollment(services, enrollment));
  const request = { approvalUrl: origin + '/manage/enrollments/' + enrollment.enrollmentId, code: introduced.request.verificationCode };
  await page.goto(request.approvalUrl);
  await page.getByLabel('Verification code').fill(request.code);
  await page.getByRole('button', { name: 'Approve roster', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Agent details →' })).toBeVisible();
  await worker.drain();
  const enrolled = value(exchangeEnrollment(services, enrollment.enrollmentId, enrollment.claimSecret)), enrolledAgent = enrolled.instances[0];
  assert(enrolledAgent?.agentId && enrolledAgent.account && enrolled.fleet?.controllerCredential);
  const profile = { id: enrolledAgent.agentId, workspace, account: { user_id: enrolledAgent.account.matrixUserId,
    access_token: enrolledAgent.account.accessToken, device_id: enrolledAgent.account.deviceId },
    settings: { instance: config.instance, homeserver: origin, server_name: config.serverName, owner: config.administrator, max_upload_bytes: 16 * 1024 * 1024 } };
  const fleetId = enrolled.fleet.fleetId;
  const rename = { ...enrollment, enrollmentId: randomUUID(), claimSecret: secret(), controllerCredential: enrolled.fleet.controllerCredential,
    instances: [{ ...enrollment.instances[0]!, name: 'holmes-max', identity: { agentId: profile.id, accessToken: profile.account.access_token } }] };
  const review = value(await introduceEnrollment(services, rename));
  await page.goto(origin + '/manage/enrollments/' + rename.enrollmentId);
  await expect(page.getByText('Rename from holmes', { exact: true })).toBeVisible();
  await expect(page.getByText(/Renamed agents keep their accounts, conversations, permissions and saved histories/u)).toBeVisible();
  await page.getByLabel('Verification code').fill(review.request.verificationCode);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('rejected', { exact: true })).toBeVisible();
  assert.equal(value(services.directory.agent(profile.id))!.name, 'holmes');
  await page.goto(request.approvalUrl);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: profile.id })), null);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), []);
  value(await connectOwnerConversation(services, { principalId: profile.id, kind: 'agent' }, profile.id));
  const ownerDirect = value(services.repositories.ownerConversation.find({ agentId: profile.id }))!;
  const mandatoryGrant = value(services.repositories.agentRoomGrant.find({ agentId: profile.id, roomId: ownerDirect.roomId }))!;
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), [mandatoryGrant]);
  await page.getByRole('link', { name: 'Agent details →' }).click();
  await expect(page.getByRole('region', { name: 'Rooms & access', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link')).toHaveText(['Rooms', 'Session', 'Activity', 'Settings']);
  await expect(page.getByLabel('Configured display name')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Who can wake this agent?', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Wake-up authority' })).toHaveValue('owner');
  await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Wake-up authority' }).locator('option')).toHaveCount(6);
  await page.getByText('Context and blocked messages', { exact: true }).click();
  await expect(page.getByText('Nobody disables chat-triggered input', { exact: false })).toBeVisible();
  for (const policy of ['nobody', 'owner-agents', 'humans', 'everyone', 'owner']) {
    await page.getByRole('combobox', { name: 'Wake-up authority' }).selectOption(policy);
    await submit(page, 'Save wake-up policy');
    await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Wake-up authority' })).toHaveValue(policy);
    assert.equal(value(services.directory.agent(profile.id))!.agent.wakeMode, policy);
    assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), [mandatoryGrant]);
  }
  assert.deepEqual(identityReads, [], 'Identity selection is read only when the selected wake-up mode is open');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Rooms', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Engineering', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Access for Engineering' }).selectOption('read');
  await submit(page, 'Save access');
  await expect(page.getByRole('button', { name: 'Save access' })).toBeEnabled();
  await worker.drain();
  const agent = { base: origin, token: profile.account.access_token };
  assert(!(await nativeOk(agent, 'PUT', API + '/rooms/' + segment(room) + '/send/m.room.message/denied', { msgtype: 'm.text', body: 'Denied' })).ok);
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Configured display name').fill('Holmes');
  await submit(page, 'Save name');
  await expect(page.getByRole('heading', { name: 'Holmes', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Rooms', exact: true }).click();
  await page.getByRole('link', { name: 'Engineering', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Native Matrix permissions', exact: true })).toBeVisible();
  const nativePermissions = page.getByRole('table', { name: 'Native permission thresholds', exact: true });
  await expect(nativePermissions).toBeHidden();
  await page.getByText('View native permission thresholds', { exact: true }).click();
  await expect(nativePermissions).toBeVisible();
  const roomResponse = await page.request.get(origin + '/api/rooms/' + encodeURIComponent(room) + '?agentId=' + profile.id);
  assert.equal(roomResponse.status(), 200);
  const thresholds = (await roomResponse.json() as { data: { authority: { nativePermissions: { action: string; level: number }[] } } }).data.authority.nativePermissions;
  for (const permission of thresholds) {
    const row = nativePermissions.getByRole('row').filter({ has: page.getByRole('cell', { name: permission.action, exact: true }) });
    await expect(row.getByRole('cell').nth(1)).toHaveText(String(permission.level));
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Engineering', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Access for Engineering' }).selectOption('custom');
  await page.getByLabel('Power level', { exact: true }).fill('50');
  await submit(page, 'Save access');
  await expect(page.locator('.subject-status .status')).toHaveText('Custom power level', { timeout: 15_000 });
  await worker.drain();
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: profile.id, roomId: room }))!.powerLevel, 50);
  await page.getByRole('link', { name: '← Agent details' }).click();
  await page.getByRole('combobox', { name: 'Access for Engineering' }).selectOption('reply');
  await submit(page, 'Save access');
  await page.waitForLoadState('load'); await worker.drain();
  await page.goto(origin + '/manage/agents');
  await expect(page.getByRole('table', { name: 'Agents', exact: true }).getByRole('link', { name: 'Holmes', exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory, 'admin-agents.png'), fullPage: true });
  const home = join(directory, 'codex-home'); mkdirSync(home);
  const provider = await nativeProvider(scope, home);
  const engine = await nativeEngine(scope, home, workspace);
  await materialize(engine, provider);
  await page.goto(origin + '/manage/agents/' + profile.id);
  await page.getByRole('combobox', { name: 'Wake-up authority' }).selectOption('nobody');
  await submit(page, 'Save wake-up policy');
  await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled();
  const stop = new AbortController();
  let listenerFailure: unknown;
  let listenerReady = false;
  const host = await createListenerHost();
  cleanup(scope, () => host.close());
  const control = createFleetControlConnection({ origin, credential: enrolled.fleet.controllerCredential, fleetId,
    owner: config.administrator, signal: new AbortController().signal, acknowledged: () => success(undefined), execute: async command => {
      if (command.action !== 'stop') return failure('invalid', 'This native browser fixture only executes its owned stop operation');
      stop.abort(); await receiving; process.kill(-engine.child.pid!, 'SIGTERM'); await engine.ended;
      return success({ status: 'succeeded', errorMessage: null });
    } });
  cleanup(scope, () => control.close());
  const binding = control.listener(profile.id);
  await until(() => control.status().connected);
  const cursorFile = join(stateDirectory, 'cursors.json');
  const receiving = listen({ binding: 'fixture', host, control: binding.control, coordination: createCoordination({ origin, token: profile.account.access_token }), release: release.manifest, settings: profile.settings, account: profile.account, id: profile.id, cursorFile,
    limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 1000, ready: () => { listenerReady = true; },
    runtime: (signal, pollMs, hooks) => connectCodex({ ...engine, pollMs, hooks }, signal),
  }, stop.signal).catch(error => { if (!stop.signal.aborted) listenerFailure = error; });
  cleanup(scope, async () => { stop.abort(); await receiving; binding.close(); });
  await until(() => listenerReady || listenerFailure !== undefined);
  assert.equal(listenerFailure, undefined, String(listenerFailure));
  await until(() => existsSync(cursorFile + '.sync'));
  const previousSync = readJson<string>(cursorFile + '.sync');
  assert((await nativeOk(human, 'PUT', API + '/rooms/' + segment(room) + '/send/m.room.message/e2e', { msgtype: 'm.text', body: 'Crossfire integrated native delivery' })).ok);
  await until(() => existsSync(cursorFile + '.sync')
    && readJson<string>(cursorFile + '.sync') !== previousSync, 'The native receiver must consume the room notification before testing Nobody');
  assert.equal(provider.requests.length, 0, 'Nobody must prevent real Matrix chat from reaching the native model transport');
  assert.equal(listenerFailure, undefined, String(listenerFailure));
  await engine.call('turn/start', { threadId: engine.session, input: [{ type: 'text', text: 'Direct native user input with Nobody selected.', text_elements: [] }] });
  await until(() => !!provider.held());
  assert.equal(provider.requests.length, 1);
  assert(!JSON.stringify(provider.requests).includes('Crossfire integrated native delivery'));
  provider.finish();
  await until(() => engine.notifications.some(notice => notice.method === 'turn/completed'));
  provider.hold();
  await page.getByRole('combobox', { name: 'Wake-up authority' }).selectOption('owner');
  await submit(page, 'Save wake-up policy');
  await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled();
  await until(() => provider.requests.some(value => JSON.stringify(value).includes('Crossfire integrated native delivery')) || listenerFailure !== undefined);
  assert.equal(listenerFailure, undefined, String(listenerFailure));
  provider.finish();
  await page.goto(origin + '/manage/agents/' + profile.id + '/activity');
  const activity = page.getByRole('region', { name: 'Listener activity' });
  await expect(activity.getByText('online', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Settings', exact: true }).click();
  const software = page.getByRole('region', { name: 'Listener software', exact: true });
  await expect(page.getByRole('button', { name: 'Retire agent', exact: true })).toBeDisabled();
  await expect(software.getByText('Current', { exact: true })).toBeVisible();
  const installedRelease = release.manifest.release;
  const requestsBeforeUpgrade = provider.requests.length;
  Object.assign(release, updatedRelease(release, 'SKILL.md', release.files['SKILL.md'].toString() + '\nFixture updated skill.\n'));
  await page.reload();
  await expect(software.getByText('Update available', { exact: true })).toBeVisible();
  await expect(software.getByRole('table', { name: 'Current listener software', exact: true }).getByText(installedRelease, { exact: true })).toBeVisible();
  await expect(software.getByRole('link', { name: 'Update instructions for this server', exact: true })).toHaveAttribute('href', '/onboarding/' + release.manifest.release + '/README.md');
  assert.equal(provider.requests.length, requestsBeforeUpgrade, 'Version discovery must not call the model');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Session', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Runtime settings', exact: true })).toBeVisible();
  await expect(page.getByText('65,536 UTF-8 bytes, including origin metadata; larger input uses private files', { exact: true })).toBeVisible();
  await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'agent-runtime.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'agent-runtime-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const run = value(services.collection.listenerRuns({ agentId: profile.id })).find(run => run.stoppedAt === null); assert(run);
  const coordination = createCoordination({ origin, token: profile.account.access_token });
  const decision = value(await coordination.createDecision(profile.id, { id: randomUUID(), runId: run.id, sessionId: engine.session,
    runtime: 'codex', requestId: 'browser-question', turnId: 'original-turn', itemId: 'original-question', kind: 'question',
    action: 'Select a destination', review: 'Complete original native scope', blocking: true, expiresAt: null,
    questions: [{ id: 'destination', title: 'Destination', prompt: 'Select an option or enter a private answer.', secret: true, allowText: true,
      options: [{ id: '0', label: 'A', description: 'First native choice' }, { id: '1', label: 'B', description: 'Second native choice' }] }] }));
  const decisionUrl = origin + '/manage/agents/' + profile.id + '/decisions/' + decision.id + '?choice=1';
  await page.reload();
  await expect(page.getByRole('table', { name: 'Pending decisions', exact: true }).getByRole('link', { name: 'Select a destination', exact: true })).toBeVisible();
  await expect(page.getByText('Answer blocking requests so the agent can continue.', { exact: false })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Decision history', exact: true })).toHaveCount(0);
  await page.goto(decisionUrl);
  await expect(page.getByRole('radio')).toHaveCount(2);
  for (const radio of await page.getByRole('radio').all()) await expect(radio).not.toBeChecked();
  assert.equal(value(await coordination.pollDecision(profile.id, decision.id)).status, 'pending', 'A choice link GET cannot submit consent');
  const denied = await page.request.post(origin + '/api/agents/' + profile.id + '/runtime-decisions/' + decision.id + '/answer',
    { data: { answers: [{ questionId: 'destination', optionId: '1', text: null }] } });
  assert.equal(denied.status(), 403, 'Answer POST requires explicit CSRF protection');
  await page.getByLabel('Private answer').fill('private browser answer');
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'agent-decision.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'agent-decision-mobile.png'), fullPage: true });
  const submission = page.waitForResponse(response => response.url().endsWith('/runtime-decisions/' + decision.id + '/answer') && response.request().method() === 'POST')
    .then(async response => ({ status: response.status(), body: await response.text() }));
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  const answered = await submission;
  assert.equal(answered.status, 200, answered.body);
  await expect(page.getByText('Answer submitted. Native response publication is reported separately; this is not proof that execution has resumed.', { exact: true })).toBeVisible();
  assert.equal(value(await coordination.pollDecision(profile.id, decision.id)).answers[0]?.text, 'private browser answer');
  await expect(page.getByLabel('Private answer')).toHaveValue('');
  assert.equal(provider.requests.length, requestsBeforeUpgrade, 'Browser review and answer are ordinary code, not model housekeeping');
  value(await coordination.receiptDecision(profile.id, decision.id, 'cancelled'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/manage/agents/' + profile.id + '/settings');
  await page.getByLabel('Configured display name').fill('Unsaved name');
  await page.waitForResponse(response => response.url().endsWith('/api/agents/' + profile.id) && response.request().method() === 'GET');
  await expect(page.getByLabel('Configured display name')).toHaveValue('Unsaved name');
  const statusRefresh = page.waitForResponse(response => response.url().endsWith('/api/agents/' + profile.id) && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await statusRefresh;
  await expect(page.getByLabel('Configured display name')).toHaveValue('Unsaved name');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(activity.getByText('online', { exact: true })).toBeVisible();
  const requestsBeforeStop = provider.requests.length;
  await expect(page.getByRole('button', { name: 'Disconnect listener', exact: true })).toHaveCount(0);
  await page.evaluate('window.scrollTo(0, 0)');
  await page.screenshot({ path: join(directory, 'agent-activity-rooms.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await page.screenshot({ path: join(directory, 'agent-activity-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Session', exact: true }).click();
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Session operations', exact: true }).locator('tbody tr').filter({ hasText: 'Stop' })).toContainText('succeeded');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(activity.getByText('offline', { exact: true })).toBeVisible({ timeout: 45_000 });
  await receiving;
  assert.equal(listenerFailure, undefined, 'Controller stop completes without an unrequested listener failure');
  assert.equal(provider.requests.length, requestsBeforeStop, 'Heartbeat and controller stop must not call the model');
  const report = await page.request.get(origin + '/api/agents/' + profile.id);
  const status = (await report.json() as { data: { activity: { messagesDelivered: number; activeMs: number } } }).data;
  assert(status.activity.messagesDelivered >= 1);
  assert(status.activity.activeMs > 0);
  assert(engine.child.exitCode !== null || engine.child.signalCode !== null, 'The controller receipt follows actual termination of its owned native process');
  await page.goto(origin + '/manage/agents/' + profile.id + '/settings?runsPage=2');
  const lastReported = page.getByRole('table', { name: 'Last reported listener software', exact: true });
  await expect(lastReported.getByText(installedRelease, { exact: true })).toBeVisible();
  await expect(page.getByText('Last reported installation. No listener is currently reporting.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Current listener software', exact: true })).toHaveCount(0);
  await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);
  await checkPaperLayout(page); await page.screenshot({ path: join(directory, 'agent-software-offline.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await checkPaperLayout(page);
  await page.screenshot({ path: join(directory, 'agent-software-offline-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(provider.requests.length, requestsBeforeStop, 'Offline software inspection must not call the model');
  await page.getByRole('link', { name: 'Invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invitation = await page.getByLabel('Share this private link once').inputValue();
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage(); memberPage.on('pageerror', error => errors.push(error.message));
  const incompleteInvitation = new URL(invitation);
  incompleteInvitation.hash = '';
  const incompletePage = await memberContext.newPage(); incompletePage.on('pageerror', error => errors.push(error.message));
  await incompletePage.goto(incompleteInvitation.href);
  await expect(incompletePage.getByRole('alert')).toHaveText('Open the complete private invitation link you received.');
  await expect(incompletePage.getByRole('button', { name: 'Continue to Element →', exact: true })).toBeDisabled();
  await checkPaperLayout(incompletePage);
  await incompletePage.screenshot({ path: join(directory, 'invitation-incomplete.png'), fullPage: true });
  await incompletePage.close();
  await memberPage.goto(invitation);
  await expect(memberPage.getByRole('heading', { name: 'You’re invited', exact: true })).toBeVisible();
  await expect(memberPage.getByLabel('Username', { exact: true })).toHaveCount(0);
  await checkPaperLayout(memberPage);
  await memberPage.screenshot({ path: join(directory, 'invitation-join.png'), fullPage: true });
  await memberPage.setViewportSize({ width: 390, height: 844 });
  assert(await memberPage.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await checkPaperLayout(memberPage);
  await memberPage.screenshot({ path: join(directory, 'invitation-join-mobile.png'), fullPage: true });
  await memberPage.getByRole('button', { name: 'Continue to Element →', exact: true }).click();
  await memberPage.waitForURL(origin + '/#/register');
  await expect(memberPage.getByLabel('Username', { exact: true })).toBeVisible();
  await memberPage.getByLabel('Username', { exact: true }).fill('alice');
  await memberPage.getByLabel('Password', { exact: true }).fill('browser-fixture-only-password');
  await memberPage.getByLabel('Confirm password', { exact: true }).fill('browser-fixture-only-password');
  await memberPage.getByRole('button', { name: 'Register', exact: true }).click();
  const invitationPopup = memberPage.waitForEvent('popup');
  await memberPage.getByRole('button', { name: 'Start authentication', exact: true }).click();
  const confirmation = await invitationPopup;
  await expect(confirmation.getByRole('heading', { name: 'Confirm your invitation', exact: true })).toBeVisible();
  await expect(confirmation.getByText('@alice:architecture.localhost', { exact: true })).toBeVisible();
  await confirmation.screenshot({ path: join(directory, 'element-invitation-confirmation.png'), fullPage: true });
  const registration = memberPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/_matrix/client/v3/register')
    .then(async response => ({ status: response.status(), body: await response.text() }));
  await confirmation.getByRole('button', { name: 'Confirm invitation', exact: true }).click();
  await expect(confirmation.getByRole('heading', { name: 'Account confirmed', exact: true })).toBeVisible();
  assert.equal((await memberContext.cookies(origin)).filter(cookie => cookie.name === '__Host-crossfire-invitation').length, 0, 'The browser stage clears its bound invitation before credential-omitting SDK requests');
  const registered = await registration;
  assert.equal(registered.status, 200, registered.body);
  assert.equal((JSON.parse(registered.body) as { user_id: string }).user_id, '@alice:architecture.localhost');
  await confirmation.close();
  await memberPage.screenshot({ path: join(directory, 'element-registration.png'), fullPage: true });
  await memberPage.goto(origin + '/manage/');
  await memberPage.getByLabel('Matrix username').fill('@alice:architecture.localhost');
  await memberPage.getByLabel('Password', { exact: true }).fill('browser-fixture-only-password');
  await memberPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(memberPage.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await expect(memberPage.getByRole('link', { name: 'Members', exact: true })).toHaveCount(0);
  assert.equal((await memberPage.request.get(origin + '/api/members')).status(), 403);
  assert.equal((await memberPage.request.get(origin + '/api/rooms')).status(), 200);
  await memberPage.setViewportSize({ width: 390, height: 844 });
  await checkEnrollmentInstructions(memberPage, origin, '@alice:architecture.localhost');
  await expect(memberPage.getByRole('link', { name: 'Manage rooms →', exact: true })).toHaveCount(0);
  assert(await memberPage.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await memberPage.screenshot({ path: join(directory, 'connect-member-mobile.png'), fullPage: true });
  await memberPage.goto(origin + '/manage/agents');
  await memberPage.screenshot({ path: join(directory, 'member-mobile.png'), fullPage: true });
  assert(await memberPage.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await page.goto(origin + '/manage/policy');
  await page.getByLabel('Agents per member owner').fill('8');
  await page.getByText('How capacity is counted', { exact: true }).click();
  await expect(page.getByText('Members use the per-owner limit.', { exact: false })).toContainText('defaults to 100 agents');
  const guidance = 'Keep replies concise.\nUse project tickets for "東京". <b>Plain text only.</b>';
  const instructionsField = page.getByLabel('Additional agent instructions', { exact: true });
  await expect(page.getByRole('button', { name: 'Reset to default', exact: true })).toBeDisabled();
  await instructionsField.fill(guidance);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings' }).click()]);
  await expect(page.getByLabel('Agents per member owner')).toHaveValue('8');
  await expect(instructionsField).toHaveValue(guidance);
  const customized = await checkEnrollmentInstructions(memberPage, origin, '@alice:architecture.localhost');
  assert(!customized.includes(guidance), 'The pasted banner stays one line');
  assert((await (await fetch(onboardingUrl(origin, '@alice:architecture.localhost'))).text()).includes(guidance), 'The linked guide owns the complete administrator instructions');
  await expect(memberPage.getByLabel('Additional agent instructions', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset to default', exact: true }).click();
  await expect(instructionsField).toHaveValue('');
  assert.equal(value(services.repositories.instancePolicy.find({ id: 'instance' }))!.agentInstructions, guidance, 'Reset is a draft until Save settings');
  await expect(page.getByLabel('Agents per member owner')).toHaveValue('8');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings' }).click()]);
  await expect(instructionsField).toHaveValue('');
  const reset = await checkEnrollmentInstructions(memberPage, origin, '@alice:architecture.localhost');
  assert(!reset.includes(guidance));
  assert(!reset.includes('Additional instructions from the system administrator:'));
  await page.goto(origin + '/manage/members');
  await expect(page.getByText('alice', { exact: true })).toBeVisible();
  await page.goto(origin + '/manage/agents/' + profile.id + '/rooms/' + encodeURIComponent(room));
  await page.getByRole('combobox', { name: 'Access for Engineering' }).selectOption('none');
  await submit(page, 'Save access');
  await worker.drain();
  await page.reload();
  await expect(page.locator('.status').filter({ hasText: /^No access$/u })).toBeVisible();
  assert.equal(value(await services.matrix.membership(config.administrator, profile.account.user_id, room)).membership, 'leave');
  const ownerConversation = value(services.repositories.ownerConversation.find({ agentId: profile.id }))!;
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })).filter(grant => grant.accessMode !== 'none').map(grant => grant.roomId), [ownerConversation.roomId]);
  await page.goto(origin + '/manage/audit');
  await expect(page.getByText('instance-policy.configure', { exact: true })).toHaveCount(2);
  const audit = page.getByRole('table', { name: 'Management activity', exact: true });
  await expect(audit.getByText('Change instance settings', { exact: true })).toHaveCount(2);
  await expect(audit.getByText('admin', { exact: true }).first()).toBeVisible();
  const adminSession = value(await createSession(services, human.token)), adminActor = value(await authenticateMember(services, adminSession.secret)).actor;
  const aliceAccount = value(await nativeOk({ base: origin }, 'POST', API + '/login', { type: 'm.login.password', identifier: { type: 'm.id.user', user: '@alice:architecture.localhost' }, password: 'browser-fixture-only-password' }));
  const aliceSession = value(await createSession(services, String(aliceAccount.access_token))), aliceActor = value(await authenticateMember(services, aliceSession.secret)).actor;
  for (const [name, actor, ownerMatrixId] of [['archived', adminActor, config.administrator], ['alice-agent', aliceActor, '@alice:architecture.localhost']] as const) {
    const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId, fleetKey: name, controller: { name: name + ' workstation', metadata: {} },
      instances: [{ instanceKey: name, name, coordinationPolicy: defaultCoordinationPolicy() }] };
    const introduced = value(await introduceEnrollment(services, input));
    value(decideEnrollment(services, actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    const id = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!.agentId!;
    if (name === 'archived') value(changeAgent(services, actor, id, { expectedRevision: value(services.directory.agent(id))!.principal.revision, status: 'revoked' }, randomUUID()));
  }
  await worker.drain();
  await page.goto(origin + '/manage/agents');
  await expect(page.getByLabel('Show active', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show suspended', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Show revoked', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Show revoked', { exact: true }).check();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Apply filters', exact: true }).click()]);
  await expect(page.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr')).toHaveCount(3);
  assert.equal(new URL(page.url()).searchParams.get('status'), 'active,suspended,revoked');
  await page.reload();
  await expect(page.getByLabel('Show revoked', { exact: true })).toBeChecked();
  await page.getByLabel('Listener status', { exact: true }).selectOption('online');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Apply filters', exact: true }).click()]);
  await expect(page.getByRole('heading', { name: 'No matching agents', exact: true })).toBeVisible();
  await memberPage.goto(origin + '/manage/agents?status=active,suspended,revoked');
  await expect(memberPage.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr')).toHaveCount(1);
  await expect(memberPage.getByRole('table', { name: 'Agents', exact: true })).toContainText('alice-agent');
  await reviewLayouts(page, origin, directory, 'administrator', ['/manage/agents', '/manage/agents/' + profile.id,
    ...['session', 'activity', 'settings'].map(section => '/manage/agents/' + profile.id + '/' + section),
    '/manage/fleets/' + fleetId, '/manage/fleets/' + fleetId + '/activity', '/manage/fleets/' + fleetId + '/activity?view=traffic', '/manage/fleets/' + fleetId + '/settings',
    '/manage/agents/' + profile.id + '/rooms/' + encodeURIComponent(room), '/manage/connect', '/manage/enrollments',
    new URL(request.approvalUrl).pathname, '/manage/members', '/manage/invitations', '/manage/policy', '/manage/audit', '/manage/not-a-page']);
  await reviewLayouts(memberPage, origin, directory, 'member', ['/manage/agents', '/manage/fleets', '/manage/enrollments', '/manage/connect', '/manage/policy']);
  for (const viewer of [page, memberPage]) {
    for (const route of ['/manage/rooms', '/manage/rooms/' + encodeURIComponent(room)]) {
      await viewer.goto(origin + route);
      await expect(viewer.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible();
      await expect(viewer.getByRole('link', { name: 'Rooms', exact: true })).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: 'Create room', exact: true })).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: 'Apply membership', exact: true })).toHaveCount(0);
    }
  }
  await page.goto(origin + '/manage/agents/' + profile.id);
  const rowSave = page.getByRole('button', { name: 'Save access', exact: true });
  await expect(rowSave).toBeVisible();
  await expect(rowSave).not.toHaveClass(/primary/u);
  assert.equal(await page.evaluate<string>('getComputedStyle(document.querySelector(".room-save")).backgroundColor'), 'rgb(251, 252, 253)');
  await checkOnboardingPolicy(page, memberPage, origin, services, adminActor);
  await page.goto(origin + '/manage/agents/' + profile.id + '/settings');
  const retire = page.getByRole('button', { name: 'Retire agent', exact: true });
  await expect(page.getByRole('region', { name: 'Retire agent', exact: true }).getByText('A session that has never started needs no stop request.', { exact: false })).toBeVisible();
  await expect(retire).toBeEnabled();
  page.removeAllListeners('dialog');
  page.once('dialog', dialog => dialog.dismiss()); await retire.click();
  assert.equal(value(services.repositories.fleetInstance.find({ ownerId: adminActor.principalId, fleetKey: 'project', instanceKey: 'holmes' }))!.retiredAt, null);
  const memberRetirement = await memberPage.request.delete(origin + '/api/fleets/' + fleetId + '/agents/' + profile.id,
    { data: { expectedRevision: value(services.repositories.fleet.findById(fleetId))!.revision, instanceKey: 'holmes' },
      headers: { 'X-Crossfire-CSRF': value(await authenticateMember(services, (await memberContext.cookies(origin)).find(cookie => cookie.name === COOKIE_NAME)!.value)).csrfSecret } });
  assert.equal(memberRetirement.status(), 403, 'Another owner cannot retire this managed identity');
  page.once('dialog', dialog => dialog.accept()); await retire.click();
  await expect(page).toHaveURL(origin + '/manage/fleets/' + fleetId);
  await expect(page.getByRole('heading', { name: 'No agents', exact: true })).toBeVisible();
  const retired = value(services.repositories.fleetInstance.find({ ownerId: adminActor.principalId, fleetKey: 'project', instanceKey: 'holmes' }))!;
  assert(retired.retiredAt !== null);
  assert.equal(value(services.repositories.principal.find({ id: profile.id }))!.matrixUserId, profile.account.user_id);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: profile.id }))!.roomId, ownerConversation.roomId);
  assert(engine.child.exitCode !== null || engine.child.signalCode !== null, 'Retirement follows an actual stopped native process');
  await page.getByRole('navigation', { name: 'Fleet views' }).getByRole('link', { name: 'Settings', exact: true }).click();
  const archive = page.getByRole('button', { name: 'Archive fleet', exact: true });
  await expect(page.getByRole('region', { name: 'Archive fleet', exact: true }).getByText('Sessions that have never started need no stop request.', { exact: false })).toBeVisible();
  await expect(archive).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss()); await archive.click();
  assert.equal(value(services.repositories.fleet.findById(fleetId))!.archivedAt, null);
  page.once('dialog', dialog => dialog.accept()); await archive.click();
  await expect(page).toHaveURL(origin + '/manage/fleets');
  await expect(page.getByRole('table', { name: 'Fleets', exact: true }).locator('a[href="/manage/fleets/' + fleetId + '"]')).toHaveCount(0);
  assert(value(services.repositories.fleet.findById(fleetId))!.archivedAt !== null);
  assert(value(services.repositories.fleetCredential.forFleet(fleetId)).every(credential => credential.revokedAt !== null));
  assert.equal(provider.requests.length, requestsBeforeStop, 'Retirement and archival do not invoke a model');
  assert.deepEqual(errors, []);
  console.log('Browser evidence: ' + directory);
});
