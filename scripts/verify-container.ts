import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { main, imageName, runArguments } from '../apps/server/src/operator.js';
import { readJson } from '../packages/files/src/index.js';
import { ARTIFACTS } from '../packages/contracts/src/release.js';
import { messageContent } from '../packages/matrix/src/message.js';
import { onboardingUrl } from '../packages/contracts/src/onboarding.js';

const root = process.cwd();
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const address = portProbe.address(); assert(address && typeof address === 'object');
const port = address.port;
await new Promise<void>(resolve => portProbe.close(() => resolve()));
const origin = 'http://127.0.0.1:' + port;
mkdirSync(join(root, '.temp'), { recursive: true });
const directory = mkdtempSync(join(root, '.temp/container-verification-'));
await main(['init', '--directory', directory, '--instance', 'verification', '--origin', origin,
  '--server-name', 'verification.localhost', '--administrator', 'admin']);
const image = imageName(root);
const arguments_ = runArguments(directory, image, port);
const name = arguments_[arguments_.indexOf('--name') + 1]!;
const secrets = readJson<{ administratorPassword: string }>(join(directory, 'bootstrap.json'));
if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.log('Building the verification image: ' + image);
  const build = spawnSync('docker', ['build', '--tag', image, root], { stdio: 'inherit', timeout: 1_800_000 });
  assert.equal(build.status, 0, 'Verification image build failed');
}

async function start() {
  const child = spawn(process.execPath, [join(root, 'crossfire'), 'start', '--directory', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-24_000); });
  child.stderr.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-24_000); });
  const ended = once(child, 'close');
  async function close() {
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25_000);
    try { assert.deepEqual(await ended, [0, null], output); }
    finally {
      clearTimeout(timeout);
      if (spawnSync('docker', ['inspect', name], { stdio: 'ignore' }).status === 0) {
        spawnSync('docker', ['stop', '--time', '10', name], { stdio: 'ignore' });
        assert.fail('Orderly operator exit did not remove its container');
      }
    }
  }
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      assert.equal(child.exitCode, null, output);
      try {
        const health = await fetch(origin + '/_coord/health', { signal: AbortSignal.timeout(2000) });
        if (health.ok) break;
      } catch {}
      assert(Date.now() < deadline, 'Container readiness timed out: ' + output);
      await delay(100);
    }
  } catch (error) { await close(); throw error; }
  return { close };
}

const browser = await chromium.launch({ executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true });
const additionalInstructions = 'Use project tickets.\nKeep replies concise. 東京';
let publicRoom: string | undefined;
try {
  for (const iteration of [0, 1]) {
    const stack = await start();
    try {
      const inspection = spawnSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', name], { encoding: 'utf8' });
      assert.equal(inspection.status, 0);
      assert.deepEqual(JSON.parse(inspection.stdout), { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] });
      const discovery = await fetch(origin + '/.well-known/matrix/client');
      assert.deepEqual(await discovery.json(), { 'm.homeserver': { base_url: origin } });
      assert.equal((await fetch(origin + '/_matrix/client/versions')).status, 200);
      assert.equal((await fetch(origin + '/config.json')).status, 200);
      for (const path of ['/config.json/../bootstrap.json', '/manage/assets/%2e%2e%2fpackage.json', '/_coord/install.mjs']) {
        assert.equal((await fetch(origin + path)).status, 404);
      }
      const health = await (await fetch(origin + '/_coord/health')).json() as { instance: string; version: string; release: string; runtime: string; startedAt: string };
      assert.equal(health.instance, 'verification');
      assert.match(health.runtime, /^node 26\./u);
      assert(Number.isFinite(Date.parse(health.startedAt)));
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
        assert.equal(copied, [
          'Connect this project to Crossfire for @admin:verification.localhost.',
          'Follow the setup guide: ' + setupUrl,
          'Reuse the existing project identity; if none exists, ask me for a name. Show me any approval link and code.',
          ...(iteration === 1 ? ['', 'Additional instructions from the system administrator:', additionalInstructions] : []),
        ].join('\n'));
        const guide = await fetch(setupUrl);
        assert.equal(guide.status, 200);
        assert((await guide.text()).includes(origin + '/onboarding/' + health.release + '/crossfire-client.mjs'));
        assert(!copied.includes(secrets.administratorPassword));
        assert.equal(copied.includes(additionalInstructions), iteration === 1);
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.getByRole('button', { name: 'Copy instructions', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('Copied. Paste into your coding agent.');
        assert.equal(await page.evaluate<string>('navigator.clipboard.readText()'), copied);
        await page.screenshot({ path: join(directory, 'connect-' + iteration + '.png'), fullPage: true });
        await page.goto(origin + '/manage/policy');
        if (iteration === 0) {
          await page.getByLabel('Agents per owner').fill('9');
          await page.getByLabel('Additional agent instructions', { exact: true }).fill(additionalInstructions);
          await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings' }).click()]);
        }
        await expect(page.getByLabel('Agents per owner')).toHaveValue('9');
        await expect(page.getByLabel('Additional agent instructions', { exact: true })).toHaveValue(additionalInstructions);
        await page.screenshot({ path: join(directory, 'management-' + iteration + '.png') });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    } finally { await stack.close(); }
  }
} finally { await browser.close(); }
console.log('Container startup, Element public-room creation and attachment download, React/native routes, artifacts, shutdown and persisted rooms passed: ' + directory);
