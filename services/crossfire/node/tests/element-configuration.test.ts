import { matrixPublicRoutes } from '@ctlflow/crossfire-adapter-matrix/web/router';
import { matrixSettings } from './support/matrix-config.js';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { browserOptions, secureRouter } from '@ctlflow/crossfire-test-support/tls';
import { publicRouter } from '../apps/server/src/router.js';
import { readElementPresentation } from '@ctlflow/crossfire-adapter-matrix/web/element-configuration';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { changeInstancePolicy } from '@ctlflow/crossfire-domain/policy/change-policy';
import { createMemberInvitation } from '@ctlflow/crossfire-domain/member/invitation';

test('default Element and shared management UI branding use the crossfire product name', { timeout: 120000 }, async scope => {
  const { application, admin } = await applicationFixture(scope);
  const backend = await httpFixture(scope, application, await releaseFixture());
  const web = join(process.cwd(), 'dist/web');
  const routes = { publicOrigin: backend.origin, service: backend.server, matrixOrigin: matrixSettings(application.config).matrixOrigin, web, element: web };
  const { origin } = await secureRouter(scope, publicRouter({ get publicOrigin() { return routes.publicOrigin; }, service: routes.service, web: routes.web, backend: matrixPublicRoutes(routes) }));
  routes.publicOrigin = origin; application.config.publicOrigin = origin; application.services.instance.publicOrigin = origin;
  for (const path of ['/config.json', '/config.' + new URL(origin).hostname + '.json']) {
    const response = await fetch(origin + path); assert.equal(response.status, 200);
    const configuration = await response.json() as Record<string, unknown>;
    assert.equal(configuration.brand, 'crossfire'); assert.equal(configuration.default_theme, 'light');
  }
  const browser = await chromium.launch(browserOptions); cleanup(scope, () => browser.close());
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport }); cleanup(scope, () => context.close());
    await context.addCookies([{ name: '__Host-crossfire', value: admin.secret, url: origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/manage/agents'); await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    await expect(page).toHaveTitle('crossfire · Management'); await expect(page.locator('.brand')).toHaveText('crossfire↗');
    assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth')); assert.deepEqual(errors, []);
  }
});

test('Element presentation owns branding, not instance origin or access policy', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'element-presentation-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  assert.deepEqual(readElementPresentation(directory, 'https://example.test'), {});
  const path = join(directory, 'config.example.test.json');
  const presentation = { brand: 'GAAP', default_theme: 'custom-Paper', branding: { auth_header_logo_url: '/gaap/logo.svg' },
    embedded_pages: { welcome_url: '/gaap/welcome.html' }, setting_defaults: { custom_themes: [{ name: 'Paper' }] } };
  writeFileSync(path, JSON.stringify({ ...presentation, disable_registration: false, disable_custom_urls: false,
    default_server_config: { 'm.homeserver': { base_url: 'https://elsewhere.test' } } }));
  assert.deepEqual(readElementPresentation(directory, 'https://example.test'), presentation);
  for (const invalid of ['[]', 'null', '{', ' '.repeat(65537)]) {
    writeFileSync(path, invalid);
    assert.throws(() => readElementPresentation(directory, 'https://example.test'));
  }
});

test('both Element configuration URLs preserve branding and reflect enforced signup policy and invitations', { timeout: 120000 }, async scope => {
  const presentation = { brand: 'GAAP', default_theme: 'custom-Paper', setting_defaults: { custom_themes: [{ name: 'Paper' }] },
    disable_registration: false, disable_custom_urls: false, custom_translations_url: 'https://elsewhere.test/translations.json',
    default_server_config: { 'm.homeserver': { base_url: 'https://elsewhere.test' } } };
  const { origin, services, admin } = await nativeServer(scope, await releaseFixture(), presentation);
  const configuration = async (path: string, disabled: boolean, cookie = '') => {
    const response = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.brand, 'GAAP');
    assert.equal(body.default_theme, 'custom-Paper');
    assert.deepEqual(body.setting_defaults, presentation.setting_defaults);
    assert.equal(body.custom_translations_url, '/manage/assets/element-translations.json');
    assert.equal(body.disable_registration, disabled);
    assert.equal(body.disable_custom_urls, true);
    assert.deepEqual(body.default_server_config, { 'm.homeserver': { base_url: origin, server_name: services.messaging.serviceUserId().split(':').slice(1).join(':') } });
  };
  const paths = ['/config.json', '/config.' + new URL(origin).hostname + '.json'];
  for (const path of paths) await configuration(path, true);
  const translations = await fetch(origin + '/manage/assets/element-translations.json');
  assert.equal(translations.status, 200);
  assert.equal(translations.headers.get('content-type'), 'application/json');
  assert.equal(translations.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await translations.json(), JSON.parse(readFileSync(join(process.cwd(), 'apps/web/assets/element-translations.json'), 'utf8')));
  const policy = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  value(changeInstancePolicy(services, admin.actor, { ...policy, expectedRevision: policy.revision, signupMode: 'open' }, 'open'));
  for (const path of paths) await configuration(path, false);
  const openPolicy = value(services.repositories.instancePolicy.find({ id: 'instance' }))!;
  value(changeInstancePolicy(services, admin.actor, { ...openPolicy, expectedRevision: openPolicy.revision, signupMode: 'invitation' }, 'close'));
  const invitation = value(createMemberInvitation(services, admin.actor, { roleCode: 'member', expiresSeconds: 600 }, 'invite'));
  const response = await fetch(origin + '/api/member-invitations/' + invitation.invitationId + '/claim', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ claimSecret: invitation.claimSecret }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  for (const path of paths) { await configuration(path, false, cookie); await configuration(path, true); }
});
