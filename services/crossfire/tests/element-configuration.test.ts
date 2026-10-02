import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readElementPresentation } from '../apps/server/src/element-configuration.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { changeInstancePolicy } from '@crossfire/domain/policy/change-policy';
import { createMemberInvitation } from '@crossfire/domain/member/invitation';

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
    disable_registration: false, disable_custom_urls: false, default_server_config: { 'm.homeserver': { base_url: 'https://elsewhere.test' } } };
  const { origin, services, admin } = await nativeServer(scope, await releaseFixture(), presentation);
  const configuration = async (path: string, disabled: boolean, cookie = '') => {
    const response = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.brand, 'GAAP');
    assert.equal(body.default_theme, 'custom-Paper');
    assert.deepEqual(body.setting_defaults, presentation.setting_defaults);
    assert.equal(body.disable_registration, disabled);
    assert.equal(body.disable_custom_urls, true);
    assert.deepEqual(body.default_server_config, { 'm.homeserver': { base_url: origin, server_name: services.instance.serverName } });
  };
  const paths = ['/config.json', '/config.' + new URL(origin).hostname + '.json'];
  for (const path of paths) await configuration(path, true);
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
