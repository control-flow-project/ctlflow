import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { createSession } from '@crossfire/domain/session/create-session';
import { authenticateMember } from '@crossfire/domain/session/authenticate';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { changeAgent } from '@crossfire/domain/agent/change-agent';
import { randomUUID } from 'node:crypto';
import { publicRouter } from '../apps/server/src/router.js';
import { releaseFixture, updatedRelease } from './release-fixture.js';
import { enroll, connect } from '../apps/client/src/enrollment.js';
import { paths, readProfile } from '@crossfire/adapter-filesystem/project';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';
import { nativeProvider } from '../scripts/test-support/native-provider.js';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { connectCodex } from '@crossfire/adapter-codex/connection';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { until } from '../scripts/test-support/listener.js';
import { ARTIFACTS } from '@crossfire/contracts/release';
import { onboardingUrl } from '@crossfire/contracts/onboarding';
import { checkPaperLayout } from './support/browser-layout.js';
import { elementAssets } from './support/element.js';
import { checkOnboardingPolicy } from './support/onboarding-browser.js';

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

async function checkEnrollmentInstructions(page: Page, origin: string, owner: string): Promise<string> {
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
  for (const runtime of ['Claude Code', 'Pi', 'Codex']) assert(guide.includes(runtime), 'The setup guide describes each supported individual runtime');
  await expect(page.getByText('Open your project in Codex, Claude Code or Pi', { exact: false })).toBeVisible();
  assert(guide.includes('createHash("sha256")'));
  assert(guide.includes('node .crossfire/client.mjs agent connect'));
  assert(guide.includes('node .crossfire/client.mjs agent test'));
  assert(guide.includes('Linux or macOS'));
  assert(guide.includes('runcodex.sh download is NOT required'));
  assert(guide.includes('https://nodejs.org/en/download'));
  assert(guide.includes(owner));
  assert(guide.includes(base + 'crossfire-client.mjs'));
  await expect(page.getByRole('link', { name: 'Read the full guide for your account →', exact: true })).not.toBeVisible();
  await details.locator('summary').click();
  await expect(page.getByRole('link', { name: 'Read the full guide for your account →', exact: true })).toHaveAttribute('href', setupUrl);
  await expect(page.getByRole('link', { name: 'Download optional runcodex.sh' })).toHaveAttribute('href', '/onboarding/' + health.release + '/runcodex.sh');
  const names = ['manifest.json', ...ARTIFACTS];
  for (const name of names) {
    assert.equal((await fetch(base + name)).status, 200);
  }
  await expect(page.getByRole('link', { name: 'Review enrollment requests →', exact: true })).toHaveAttribute('href', '/manage/enrollments');
  await expect(page.getByRole('heading', { name: 'Approve your agent', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose where it can listen', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'One agent', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Fleet · advanced', exact: true })).toHaveAttribute('href', '/manage/connect/fleet');
  await expect(page.getByRole('link', { name: 'Rooms', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage rooms →', exact: true })).toHaveCount(0);
  await expect(page.getByText('Approval creates its account, not room access.', { exact: false })).toBeVisible();
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

async function reviewLayouts(page: Page, origin: string, directory: string, role: 'administrator' | 'member', routes: string[]) {
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

test('real browser member/admin flows and project listener span native Conduit, SQLite and Codex WS', { timeout: 180_000 }, async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/browser-'));
  const jwtSecret = secret();
  const matrix = await conduitFixture(scope, { jwtSecret });
  const config = { instance: 'browser', serverName: 'architecture.localhost', publicOrigin: 'http://127.0.0.1',
    matrixOrigin: matrix.base, administrator: '@admin:architecture.localhost', registrationSecret: matrix.registrationToken, jwtSecret };
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
    web: join(process.cwd(), 'dist/web'), element: elementAssets() };
  const router = publicRouter(routes);
  router.listen(0, '127.0.0.1'); await once(router, 'listening');
  const publicAddress = router.address(); assert(publicAddress && typeof publicAddress === 'object');
  const origin = 'http://127.0.0.1:' + publicAddress.port;
  routes.publicOrigin = origin; config.publicOrigin = origin; services.instance.publicOrigin = origin;
  cleanup(scope, async () => { services.matrix.close(); router.closeAllConnections(); service.closeAllConnections();
    await new Promise<void>(resolve => router.close(() => resolve())); await new Promise<void>(resolve => service.close(() => resolve()));
    await worker.stop(); application.close(); });
  const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
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
  const destination = paths(workspace, 'holmes');
  const enrolled = await enroll(destination, origin, config.administrator, 'holmes', release.manifest);
  assert(enrolled.ok);
  const request = enrolled.value as { code: string; approvalUrl: string };
  await page.goto(request.approvalUrl);
  await page.getByLabel('Verification code').fill(request.code);
  await page.getByRole('button', { name: 'Approve roster', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Agent details →' })).toBeVisible();
  await worker.drain();
  assert((await connect(destination, release.manifest)).ok);
  const profile = readProfile(destination.profile);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), []);
  await page.getByRole('link', { name: 'Agent details →' }).click();
  await expect(page.getByRole('region', { name: 'Rooms & access', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Wake-up authority' })).toHaveCount(0);
  await expect(page.getByLabel('Configured display name')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Wake-up rules', exact: true }).click();
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
    assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), []);
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
  await page.goto(origin + '/manage/agents/' + profile.id + '/wake');
  await page.getByRole('combobox', { name: 'Wake-up authority' }).selectOption('nobody');
  await submit(page, 'Save wake-up policy');
  await expect(page.getByRole('button', { name: 'Save wake-up policy' })).toBeDisabled();
  const stop = new AbortController();
  let listenerFailure: unknown;
  let listenerReady = false;
  const receiving = listen({ coordination: createCoordination({ origin, token: profile.account.access_token }), release: release.manifest, settings: profile.settings, account: profile.account, id: profile.id, cursorFile: join(destination.state, 'cursors.json'),
    limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 1000, ready: () => { listenerReady = true; },
    runtime: (signal, pollMs, hooks) => connectCodex({ ...engine, pollMs, hooks }, signal),
  }, stop.signal).catch(error => { listenerFailure = error; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => listenerReady || listenerFailure !== undefined);
  assert.equal(listenerFailure, undefined, String(listenerFailure));
  await until(() => existsSync(join(destination.state, 'cursors.json.sync')));
  const previousSync = readJson<string>(join(destination.state, 'cursors.json.sync'));
  assert((await nativeOk(human, 'PUT', API + '/rooms/' + segment(room) + '/send/m.room.message/e2e', { msgtype: 'm.text', body: 'Crossfire integrated native delivery' })).ok);
  await until(() => existsSync(join(destination.state, 'cursors.json.sync'))
    && readJson<string>(join(destination.state, 'cursors.json.sync')) !== previousSync, 'The native receiver must consume the room notification before testing Nobody');
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
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Software', exact: true }).click();
  const software = page.getByRole('region', { name: 'Listener software', exact: true });
  await expect(software.getByText('Current', { exact: true })).toBeVisible();
  const installedRelease = release.manifest.release;
  const requestsBeforeUpgrade = provider.requests.length;
  Object.assign(release, updatedRelease(release, 'SKILL.md', release.files['SKILL.md'].toString() + '\nFixture updated skill.\n'));
  await page.reload();
  await expect(software.getByText('Update available', { exact: true })).toBeVisible();
  await expect(software.locator('tbody').getByText(installedRelease, { exact: true })).toBeVisible();
  await expect(software.getByRole('link', { name: 'Update instructions for this server', exact: true })).toHaveAttribute('href', '/onboarding/' + release.manifest.release + '/README.md');
  assert.equal(provider.requests.length, requestsBeforeUpgrade, 'Version discovery must not call the model');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Configured display name').fill('Unsaved name');
  await page.waitForResponse(response => response.url().endsWith('/api/agents/' + profile.id) && response.request().method() === 'GET');
  await expect(page.getByLabel('Configured display name')).toHaveValue('Unsaved name');
  await page.getByRole('navigation', { name: 'Agent sections' }).getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(activity.getByText('online', { exact: true })).toBeVisible();
  const requestsBeforeDisconnect = provider.requests.length;
  page.removeAllListeners('dialog');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Disconnect listener', exact: true }).click();
  await expect(activity.getByText('online', { exact: true })).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  await page.evaluate('window.scrollTo(0, 0)');
  await page.screenshot({ path: join(directory, 'agent-activity-rooms.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'));
  await page.screenshot({ path: join(directory, 'agent-activity-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Disconnect listener', exact: true }).click();
  await expect(activity.getByText('disconnecting', { exact: true })).toBeVisible();
  await expect(activity.getByText('offline', { exact: true })).toBeVisible({ timeout: 45_000 });
  await receiving;
  assert.match(String(listenerFailure), /requested.*disconnect/);
  assert.equal(provider.requests.length, requestsBeforeDisconnect, 'Heartbeat and disconnect must not call the model');
  const report = await page.request.get(origin + '/api/agents/' + profile.id);
  const status = (await report.json() as { data: { activity: { messagesDelivered: number; activeMs: number } } }).data;
  assert(status.activity.messagesDelivered >= 1);
  assert(status.activity.activeMs > 0);
  assert.equal(engine.child.exitCode, null, 'Stopping the listener must not stop the external engine');
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
  const registration = memberPage.waitForResponse(response => response.request().method() === 'POST' && /^\/_matrix\/client\/(?:v3|r0)\/register$/u.test(new URL(response.url()).pathname));
  await confirmation.getByRole('button', { name: 'Confirm invitation', exact: true }).click();
  await expect(confirmation.getByRole('heading', { name: 'Account confirmed', exact: true })).toBeVisible();
  assert.equal((await memberContext.cookies(origin)).filter(cookie => cookie.name === 'crossfire_invitation').length, 0, 'The browser stage clears its bound invitation before credential-omitting SDK requests');
  const registered = await registration;
  assert.equal(registered.status(), 200, await registered.text());
  assert.equal((await registered.json() as { user_id: string }).user_id, '@alice:architecture.localhost');
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
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })).filter(grant => grant.accessMode !== 'none'), []);
  await page.goto(origin + '/manage/audit');
  await expect(page.getByText('instance-policy.configure', { exact: true })).toHaveCount(2);
  const audit = page.getByRole('table', { name: 'Management activity', exact: true });
  await expect(audit.getByText('Change instance settings', { exact: true })).toHaveCount(2);
  await expect(audit.getByText('admin', { exact: true }).first()).toBeVisible();
  const adminSession = value(await createSession(services, human.token)), adminActor = value(await authenticateMember(services, adminSession.secret)).actor;
  const aliceAccount = value(await nativeOk({ base: origin }, 'POST', API + '/login', { type: 'm.login.password', identifier: { type: 'm.id.user', user: '@alice:architecture.localhost' }, password: 'browser-fixture-only-password' }));
  const aliceSession = value(await createSession(services, String(aliceAccount.access_token))), aliceActor = value(await authenticateMember(services, aliceSession.secret)).actor;
  for (const [name, actor, ownerMatrixId] of [['archived', adminActor, config.administrator], ['alice-agent', aliceActor, '@alice:architecture.localhost']] as const) {
    const input = { enrollmentId: randomUUID(), claimSecret: secret(), ownerMatrixId, fleetKey: null, instances: [{ instanceKey: name, name }] };
    const introduced = value(await introduceEnrollment(services, input));
    value(decideEnrollment(services, actor, input.enrollmentId, { expectedRevision: 0, decision: 'approve', verificationCode: introduced.request.verificationCode }, randomUUID()));
    const id = value(services.collection.enrollmentItems({ requestId: input.enrollmentId }))[0]!.agentId!;
    if (name === 'archived') value(changeAgent(services, actor, id, { expectedRevision: 0, status: 'revoked' }, randomUUID()));
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
    ...['wake', 'activity', 'software', 'settings'].map(section => '/manage/agents/' + profile.id + '/' + section),
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
  assert.deepEqual(errors, []);
  console.log('Browser evidence: ' + directory);
});
