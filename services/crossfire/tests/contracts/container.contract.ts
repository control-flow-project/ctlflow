import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { messageContent } from '@ctlflow/crossfire-adapter-matrix/message';
import { onboardingUrl, setupDescriptorUrl, setupDescriptorSchema } from '@ctlflow/crossfire-contracts/onboarding';
import { browserOptions } from '@ctlflow/crossfire-test-support/tls';
import type { ContainerStack } from './container-fixture.js';

export async function containerContracts(scope: TestContext, fixture: ContainerStack): Promise<void> {
  const root = process.cwd();
  const repository = resolve(root, '../..');
  const cgroupParent = process.env.CROSSFIRE_TEST_CGROUP_PARENT ?? '';
  assert(cgroupParent, 'Run the repository-root verify:container command inside a verified bounded test scope');
  const { origin, state: directory, port, contentPort, containerName: name } = fixture;
  const release = JSON.parse(readFileSync(join(fixture.packages, fixture.current().name, 'release.json'), 'utf8')) as { migrationImage: string };
  const checked = spawnSync('docker', ['run', '--rm', '--cgroup-parent', cgroupParent, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', 'type=bind,source=' + directory + ',target=/runtime,readonly', '--entrypoint', 'node', release.migrationImage, '/app/services/crossfire/dist/scripts/container-configuration.js',
    '--directory', '/runtime', '--instance', 'verification', '--origin', origin, '--content-origin', 'http://localhost:' + contentPort, '--server-name', 'verification.localhost'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(checked.status, 0, checked.stderr);
  const empty = await fetch(origin + '/_matrix/client/v3/joined_rooms', { headers: { Authorization: 'Bearer ' + fixture.owner.nativeToken } });
  assert.equal(empty.status, 200); assert.deepEqual((await empty.json() as { joined_rooms: string[] }).joined_rooms, [], 'First-run Element assertions precede room-seeding API scenarios');
  const secrets = readJson<{ administratorPassword: string }>(join(directory, 'bootstrap.json'));
  const browser = await chromium.launch(browserOptions);
  const additionalInstructions = 'Use project tickets.\nKeep replies concise. 東京';
  let publicRoom: string | undefined;
  try {
    for (const iteration of [0, 1]) {
      if (iteration) await fixture.restart();
      const parent = spawnSync('docker', ['inspect', '--format', '{{.HostConfig.CgroupParent}}', name], { encoding: 'utf8' });
      assert.equal(parent.status, 0); assert.equal(parent.stdout.trim(), cgroupParent);
      const containerId = spawnSync('docker', ['inspect', '--format', '{{.Id}}', name], { encoding: 'utf8' });
      assert.equal(containerId.status, 0); assert.match(containerId.stdout.trim(), /^[a-f0-9]{64}$/u);
      const license = spawnSync('docker', ['exec', name, 'cat', '/app/LICENSE'], { encoding: 'utf8' });
      assert.equal(license.status, 0);
      assert.equal(license.stdout, readFileSync(join(repository, 'LICENSE'), 'utf8'), 'The distribution retains its root MIT license');
      const actualGroup = spawnSync('systemctl', ['--user', 'show', 'docker-' + containerId.stdout.trim() + '.scope', '--property=ControlGroup', '--value'], { encoding: 'utf8' });
      assert.equal(actualGroup.status, 0);
      assert(actualGroup.stdout.trim().endsWith('/' + cgroupParent + '/docker-' + containerId.stdout.trim() + '.scope'), 'The actual runtime process group belongs to the finite Docker verification slice');
      const inspection = spawnSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', name], { encoding: 'utf8' });
      assert.equal(inspection.status, 0);
      assert.deepEqual(JSON.parse(inspection.stdout), { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }], '8082/tcp': [{ HostIp: '127.0.0.1', HostPort: String(contentPort) }] });
      const discovery = await fetch(origin + '/.well-known/matrix/client');
      assert.deepEqual(await discovery.json(), { 'm.homeserver': { base_url: origin } });
      assert.equal((await fetch(origin + '/_matrix/client/versions')).status, 200);
      assert.equal((await fetch(origin + '/config.json')).status, 200);
      for (const path of ['/config.json/../bootstrap.json', '/manage/assets/%2e%2e%2fpackage.json', '/_coord/install.mjs']) {
        assert.equal((await fetch(origin + path)).status, 404);
      }
      const health = (await (await fetch(origin + '/api/health')).json() as { data: { instance: string; version: string; release: string; startedAt: number } }).data;
      assert.equal(health.instance, 'verification');
      const sourceExclusion = spawnSync('docker', ['exec', name, 'sh', '-c', 'test ! -d /app/services/crossfire/csharp && test ! -d /app/services/crossfire/node/tests && test ! -d /app/services/crossfire/dist/tests && test ! -d /app/services/crossfire/node/packages/domain/src'], { encoding: 'utf8' });
      assert.equal(sourceExclusion.status, 0, 'Runtime images exclude build/test and other implementation source');
      assert(Number.isSafeInteger(health.startedAt) && health.startedAt > 0 && health.startedAt <= Date.now());
      for (const suffix of ['manifest.json', ...ARTIFACTS]) {
        assert.equal((await fetch(origin + '/onboarding/' + health.release + '/' + suffix)).status, 200);
      }
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/');
        await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
        await page.screenshot({ path: join(directory, 'element-' + iteration + '.png') });
        await page.getByRole('link', { name: 'Sign in', exact: true }).click();
        await page.getByLabel('Username', { exact: true }).fill('@admin:verification.localhost');
        await page.getByLabel('Password', { exact: true }).fill(secrets.administratorPassword);
        const nativeLogin = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/_matrix/client/v3/login');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        const authenticated = await nativeLogin;
        assert.equal(authenticated.status(), 200);
        const account = await authenticated.json() as { user_id: string; access_token: string };
        assert.equal(account.user_id, '@admin:verification.localhost');
        if (iteration === 0) {
          await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0, { timeout: 40000 });
          await page.getByRole('textbox', { name: 'Password', exact: true }).fill(secrets.administratorPassword);
          await page.getByRole('button', { name: 'Continue', exact: true }).click();
          await expect(page.getByRole('heading', { name: 'Setting up keys', exact: true })).toHaveCount(0);
          await page.getByRole('button', { name: 'New room', exact: true }).click();
          await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Verification public room');
          await page.getByRole('button', { name: 'Room visibility', exact: true }).click();
          await page.getByRole('option', { name: 'Public room', exact: true }).click();
          await page.getByRole('textbox', { name: 'Room address', exact: true }).fill('verification-public');
          const creation = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/_matrix/client/v3/createRoom');
          await page.getByRole('button', { name: 'Create room', exact: true }).click();
          const created = await creation;
          const result = await created.json() as { room_id?: string };
          assert.equal(created.status(), 200, JSON.stringify(result));
          assert.equal(typeof result.room_id, 'string');
          publicRoom = result.room_id;
          await expect(page.getByRole('dialog', { name: 'Create a public room', exact: true })).toHaveCount(0);
          await page.waitForURL(url => url.hash.startsWith('#/room/'));
          await page.screenshot({ path: join(directory, 'element-public-room.png'), fullPage: true });
          const filename = 'attachment-東京.csv';
          const bytes = Buffer.from('name,value\r\n"東京",42\r\n', 'utf8');
          const authorization = { Authorization: 'Bearer ' + account.access_token };
          const upload = await fetch(origin + '/_matrix/media/v3/upload?filename=' + encodeURIComponent(filename), {
            method: 'POST', headers: { ...authorization, 'Content-Type': 'text/csv' }, body: bytes,
          });
          assert.equal(upload.status, 200);
          const media = await upload.json() as { content_uri: string };
          const message = messageContent({ msgtype: 'm.file', body: filename, url: media.content_uri,
            info: { mimetype: 'text/csv', size: bytes.length } });
          const send = await fetch(origin + '/_matrix/client/v3/rooms/' + encodeURIComponent(publicRoom!) + '/send/m.room.message/attachment-proof', {
            method: 'PUT', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(message),
          });
          assert.equal(send.status, 200);
          const sent = await send.json() as { event_id: string };
          const tile = page.locator('[data-event-id="' + sent.event_id + '"]');
          await expect(tile).toBeVisible();
          const downloadReady = page.waitForEvent('download');
          await tile.getByRole('button', { name: /attachment.*csv/u }).click();
          const download = await downloadReady;
          assert.equal(download.suggestedFilename(), filename);
          const downloaded = join(directory, filename);
          await download.saveAs(downloaded);
          assert.deepEqual(readFileSync(downloaded), bytes);
          assert.equal(await download.failure(), null);
          await expect(page.locator('iframe[src="usercontent/"]')).toHaveAttribute('sandbox', 'allow-scripts allow-downloads');
          const unauthenticated = await fetch(origin + '/_matrix/client/v1/media/download/' + media.content_uri.slice('mxc://'.length));
          assert.equal(unauthenticated.status, 401);
          console.log('Element attachment button downloads exact authenticated CSV bytes and filename; native sandbox and unauthenticated denial retained.');
        }
        assert(publicRoom);
        const headers = { Authorization: 'Bearer ' + account.access_token };
        const state = await fetch(origin + '/_matrix/client/v3/rooms/' + encodeURIComponent(publicRoom) + '/state/m.room.join_rules', { headers });
        assert.equal(state.status, 200);
        assert.equal((await state.json() as { join_rule: string }).join_rule, 'public');
        const joined = await fetch(origin + '/_matrix/client/v3/joined_rooms', { headers });
        assert.equal(joined.status, 200);
        assert((await joined.json() as { joined_rooms: string[] }).joined_rooms.includes(publicRoom));
        await page.goto(origin + '/manage/');
        await page.getByLabel('Matrix username').fill('@admin:verification.localhost');
        await page.getByLabel('Password', { exact: true }).fill(secrets.administratorPassword);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
        await page.goto(origin + '/manage/connect');
        const instructions = page.getByLabel('Instructions for your agent', { exact: true });
        await expect(instructions).toBeVisible();
        const copied = await instructions.inputValue();
        const setupUrl = onboardingUrl(origin, '@admin:verification.localhost');
        assert.equal(copied, 'Follow the setup instructions at ' + setupUrl + '.');
        const guide = await fetch(setupUrl);
        assert.equal(guide.status, 200);
        const guideText = await guide.text();
        const descriptorUrl = setupDescriptorUrl(origin, account.user_id);
        assert(guideText.includes('@ctlflow/fleet@' + health.version));
        assert(guideText.includes('Always install the Node.js @ctlflow/fleet CLI and its Node.js fleetd dependency, regardless of the server implementation.'));
        assert(guideText.includes('Do not attach this coding session; fleetd starts a separate managed native session.'));
        assert(!guideText.includes('dotnet '), 'Server selection cannot switch fleet setup to a .NET command');
        assert(guideText.includes('setup --descriptor ' + "'" + descriptorUrl + "'"));
        const descriptorResponse = await fetch(descriptorUrl);
        assert.equal(descriptorResponse.status, 200);
        const descriptor = setupDescriptorSchema(await descriptorResponse.json());
        assert(descriptor.ok, 'The personalized npm setup descriptor validates');
        assert.equal(descriptor.value.server, origin);
        assert.equal(descriptor.value.ownerMatrixId, account.user_id);
        assert.deepEqual(descriptor.value.package, { name: '@ctlflow/fleet', version: health.version });
        assert(!copied.includes(secrets.administratorPassword));
        assert(!copied.includes(additionalInstructions));
        assert.equal(guideText.includes(additionalInstructions), iteration === 1);
        assert.equal(descriptor.value.instructions.includes(additionalInstructions), iteration === 1);
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.getByRole('button', { name: 'Copy instructions', exact: true }).click();
        await expect(page.locator('.copy-text').getByRole('status')).toHaveText('Copied. Paste into your coding agent.');
        assert.equal(await page.evaluate<string>('navigator.clipboard.readText()'), copied);
        await page.screenshot({ path: join(directory, 'connect-' + iteration + '.png'), fullPage: true });
        await page.goto(origin + '/manage/policy');
        await page.getByText('How capacity is counted', { exact: true }).click();
        await expect(page.getByText('Members use the per-owner limit.', { exact: false })).toContainText('defaults to 100 agents');
        if (iteration === 0) {
          await page.getByLabel('Agents per member owner').fill('9');
          await page.getByLabel('Additional agent instructions', { exact: true }).fill(additionalInstructions);
          await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings' }).click()]);
        }
        await expect(page.getByLabel('Agents per member owner')).toHaveValue('9');
        await expect(page.getByLabel('Additional agent instructions', { exact: true })).toHaveValue(additionalInstructions);
        await page.screenshot({ path: join(directory, 'management-' + iteration + '.png') });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
  }
  scope.diagnostic('Actual container, Element room/media, React, artifacts and persisted room contracts passed.');
}
