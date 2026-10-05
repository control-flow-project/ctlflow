import { chromium, expect } from '@playwright/test';
import { join } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { nativeJson } from '@ctlflow/crossfire-adapter-matrix/http';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { collectPages } from '@ctlflow/crossfire-operator-support/collections';
import { withHuman, type Credentials } from '../auth.js';
import { checkPaperLayout } from './layout.js';

export async function verifyBrowser(origin: string, account: Credentials, executable: string, evidence: string, signal: AbortSignal) {
  const directory = privateDir(evidence);
  return withHuman(origin, account, signal, async human => {
    const agents = await collectPages(query => human.client.call(operations.agents, {}, {}, query), agent => agent.agentId); if (!agents.ok) return agents;
    const fleets = await collectPages(query => human.client.call(operations.fleets, {}, {}, query), fleet => fleet.fleetId); if (!fleets.ok) return fleets;
    const browser = await chromium.launch({ executablePath: executable, headless: true });
    const context = await browser.newContext();
    let token: string | undefined, csrf: string | undefined;
    const errors: string[] = [];
    const routes = ['/manage/agents', '/manage/fleets', '/manage/reports', '/manage/wake-ups', '/manage/wake-ups/new', '/manage/connect', '/manage/connect/fleet', '/manage/enrollments', '/manage/audit'];
    if (human.viewer.member.roleCode === 'administrator') routes.push('/manage/members', '/manage/invitations', '/manage/policy');
    for (const fleet of fleets.value) for (const suffix of ['', '/map', '/statistics', '/delivery', '/sessions', '/messages', '/rooms', '/settings']) routes.push('/manage/fleets/' + fleet.fleetId + suffix);
    const agent = agents.value[0];
    if (agent) for (const suffix of ['', '/wake', '/activity', '/runtime', ...(agent.deployment ? ['/sessions'] : []), '/decisions', '/software', '/settings']) routes.push('/manage/agents/' + agent.agentId + suffix);
    const abort = () => { void context.close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.name));
      await page.goto(origin + '/manage/');
      await page.getByLabel('Matrix username', { exact: true }).fill(account.matrixUserId);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      const login = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/_matrix/client/v3/login');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const signedIn = await login;
      const native: unknown = await signedIn.json();
      if (signedIn.status() !== 200 || !native || typeof native !== 'object' || !('access_token' in native) || typeof native.access_token !== 'string'
        || !('user_id' in native) || native.user_id !== account.matrixUserId) return failure('unauthorized', 'Browser native login failed');
      token = native.access_token;
      await expect(page.locator('.shell .page-heading h1')).toBeVisible();
      const current = await context.request.get(origin + '/api/sessions/current');
      const viewer = decodeResponse(await current.json(), operations.currentSession.output, false);
      if (current.status() !== 200 || !viewer.ok) return failure('native', 'Browser Crossfire session is invalid');
      csrf = viewer.value.data.csrfSecret;
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const route of routes) {
          signal.throwIfAborted();
          await page.goto(origin + route);
          await expect(page.locator('.page-heading h1')).toBeVisible();
          await expect(page.locator('.loading')).toHaveCount(0);
          await expect(page.getByRole('alert')).toHaveCount(0);
          await checkPaperLayout(page);
          if (route.endsWith('/statistics')) {
            await expect(page.getByLabel('Period', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Refresh summaries', exact: true })).toBeVisible();
          }
          if (route.endsWith('/software')) await expect(page.locator('details').filter({ has: page.locator('summary', { hasText: 'Run history' }) })).not.toHaveAttribute('open', '');
          if (route.endsWith('/map') && await page.locator('.map-node-agent').count()) {
            const node = page.locator('.map-node-agent').first();
            await node.click(); await expect(node).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#fleet-map-details')).toBeVisible();
            await page.reload(); await expect(page.locator('[aria-pressed="true"].map-node-agent')).toHaveCount(1);
            await page.locator('[aria-pressed="true"].map-node-agent').focus(); await page.keyboard.press('Escape');
            await expect(page.locator('[aria-pressed="true"].map-node-agent')).toHaveCount(0);
          }
          await page.screenshot({ path: join(directory, width + '-' + route.replaceAll('/', '-') + '.png'), fullPage: true });
        }
      }
      await page.goto(origin + '/manage/connect');
      await page.getByText('Requirements & optional launcher', { exact: true }).click();
      const link = await page.getByRole('link', { name: 'Read the full guide for your account →', exact: true }).getAttribute('href');
      if (!link || new URL(link, origin).searchParams.get('ownerMatrixId') !== account.matrixUserId) return failure('native', 'Onboarding link does not identify the signed-in user');
      if (errors.length) return failure('native', 'Management browser reported a page error');
      return success({ origin, human: account.matrixUserId, managementRoutes: routes.length * 2, screenshots: directory, modelCalls: 0 });
    } catch { return failure('native', 'Browser management verification failed; inspect the private evidence directory'); }
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
