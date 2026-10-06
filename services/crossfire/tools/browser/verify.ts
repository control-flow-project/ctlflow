import { chromium, expect } from '@playwright/test';
import { join } from 'node:path';
import { privateDir, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { nativeJson } from '@ctlflow/crossfire-adapter-matrix/http';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { collectPages } from '@ctlflow/crossfire-operator-support/collections';
import { withHuman, type Credentials } from '../auth.js';
import { checkPaperLayout } from './layout.js';
import { managementViews, managementViewports } from './views.js';
import { verifyWakePicker } from './wake-picker.js';

export function browserFailureMessage(error: unknown, secrets: readonly (string | undefined)[]): string {
  let message = error instanceof Error ? error.message : 'Unknown browser verification failure';
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[redacted]');
  return message.slice(0, 8192);
}

export async function verifyBrowser(origin: string, account: Credentials, executable: string, evidence: string, signal: AbortSignal) {
  const directory = privateDir(evidence);
  return withHuman(origin, account, signal, async human => {
    const agents = await collectPages(query => human.client.call(operations.agents, {}, {}, query), agent => agent.agentId); if (!agents.ok) return agents;
    const fleets = await collectPages(query => human.client.call(operations.fleets, {}, {}, query), fleet => fleet.fleetId); if (!fleets.ok) return fleets;
    const policy = await human.client.call(operations.policy, {}, {}); if (!policy.ok) return policy;
    const browser = await chromium.launch({ executablePath: executable, headless: true });
    const context = await browser.newContext();
    let token: string | undefined, csrf: string | undefined;
    let phase = 'sign-in';
    const errors: string[] = [];
    const views = managementViews(human.viewer, policy.value.data, agents.value, fleets.value);
    let wakePickerViewports = 0;
    const abort = () => { void context.close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.name));
      await page.goto(origin + '/manage/');
      await page.getByLabel('Matrix username', { exact: true }).fill(account.matrixUserId);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      let native: unknown;
      const loginUrl = origin + '/_matrix/client/v3/login';
      await page.route(loginUrl, async route => {
        const response = await route.fetch({ maxRedirects: 0 });
        native = await response.json();
        if (response.status() === 200 && native && typeof native === 'object' && 'access_token' in native && typeof native.access_token === 'string'
          && 'user_id' in native && native.user_id === account.matrixUserId) token = native.access_token;
        await route.fulfill({ response });
      });
      const login = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/_matrix/client/v3/login');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const signedIn = await login;
      await page.unroute(loginUrl);
      if (signedIn.status() !== 200 || !native || typeof native !== 'object' || !('access_token' in native) || typeof native.access_token !== 'string'
        || !('user_id' in native) || native.user_id !== account.matrixUserId) return failure('unauthorized', 'Browser native login failed');
      await expect(page.locator('.shell .page-heading h1')).toBeVisible();
      const current = await context.request.get(origin + '/api/sessions/current');
      const viewer = decodeResponse(await current.json(), operations.currentSession.output, false);
      if (current.status() !== 200 || !viewer.ok) return failure('native', 'Browser Crossfire session is invalid');
      csrf = viewer.value.data.csrfSecret;
      for (const viewport of managementViewports) {
        await page.setViewportSize(viewport);
        for (const view of views) {
          phase = viewport.width + ' ' + view.route;
          signal.throwIfAborted();
          await page.goto(origin + view.route);
          await expect(page.locator('.page-heading h1')).toHaveText(view.title);
          await expect(page.getByRole('heading', { name: 'Page unavailable', exact: true })).toHaveCount(0);
          await expect(page.locator('.loading')).toHaveCount(0);
          await expect(page.getByRole('alert')).toHaveCount(0);
          for (const section of view.sections) await expect(page.getByRole('heading', { name: section, level: 2, exact: true })).toBeVisible();
          if (view.navigation) {
            const navigation = page.getByRole('navigation', { name: view.navigation.label, exact: true });
            await expect(navigation.getByRole('link')).toHaveText([...view.navigation.items]);
            await expect(navigation.locator('[aria-current="page"]')).toHaveText(view.navigation.current);
          }
          await checkPaperLayout(page);
          const agent = agents.value[0];
          if (agent && agent.allowedActions.includes('configure') && agent.status !== 'revoked' && view.route === '/manage/agents/' + agent.agentId) {
            await verifyWakePicker(page, agent.agentId, viewport, join(directory, viewport.width + '-wake-picker.png'));
            wakePickerViewports++;
          }
          if (view.route.endsWith('/activity?view=traffic')) {
            await expect(page.getByLabel('Period', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Refresh summaries', exact: true })).toBeVisible();
          }
          if (view.navigation?.label === 'Agent sections' && view.navigation.current === 'Settings') {
            await expect(page.getByText('Latest server release', { exact: true })).toBeVisible();
            await expect(page.locator('details').filter({ has: page.locator('summary', { hasText: 'Run history' }) })).not.toHaveAttribute('open', '');
          }
          if (view.navigation?.label === 'Agent sections' && view.navigation.current === 'Session') {
            await expect(page.locator('.page-body > .panel').first().getByRole('heading', { level: 2 })).toHaveText('Decisions');
            await expect(page.locator('details').filter({ has: page.locator('summary', { hasText: 'Decision history' }) })).not.toHaveAttribute('open', '');
          }
          if (view.route.endsWith('/map') && await page.locator('.map-node-agent').count()) {
            const node = page.locator('.map-node-agent').first();
            await node.click(); await expect(node).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#fleet-map-details')).toBeVisible();
            await page.reload(); await expect(page.locator('[aria-pressed="true"].map-node-agent')).toHaveCount(1);
            await page.locator('[aria-pressed="true"].map-node-agent').focus(); await page.keyboard.press('Escape');
            await expect(page.locator('[aria-pressed="true"].map-node-agent')).toHaveCount(0);
          }
          await page.screenshot({ path: join(directory, viewport.width + '-' + view.route.replaceAll('/', '-') + '.png'), fullPage: true });
        }
      }
      phase = 'personalized setup guide';
      await page.goto(origin + '/manage/connect');
      await page.getByText('Requirements & advanced configuration', { exact: true }).click();
      const link = await page.getByRole('link', { name: 'Read the full guide for your account →', exact: true }).getAttribute('href');
      if (!link || new URL(link, origin).searchParams.get('ownerMatrixId') !== account.matrixUserId) return failure('native', 'Onboarding link does not identify the signed-in user');
      if (errors.length) return failure('native', 'Management browser reported a page error');
      return success({ origin, human: account.matrixUserId, managementRoutes: views.length * managementViewports.length, wakePickerViewports, screenshots: directory, modelCalls: 0 });
    } catch (error) {
      const message = browserFailureMessage(error, [account.password, human.nativeAccessToken, token, csrf]);
      writeJson(join(directory, 'failure.json'), { phase, message });
      return failure('native', 'Browser management verification failed at ' + phase + '; inspect the private evidence directory');
    }
    finally {
      signal.removeEventListener('abort', abort);
      try {
        if (csrf) {
          const ended = await context.request.delete(origin + '/api/sessions/current', { headers: { Origin: origin, 'X-Crossfire-CSRF': csrf }, data: {} });
          if (ended.status() !== 200) throw new Error('Browser session logout failed');
        }
      } finally {
        try { if (token) await nativeJson({ base: origin, token }, 'POST', '/_matrix/client/v3/logout', {}); }
        finally { await context.close(); await browser.close(); }
      }
    }
  });
}
