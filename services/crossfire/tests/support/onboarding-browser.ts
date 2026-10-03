import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { Services, Actor } from '@crossfire/domain/port/services';
import { createMemberInvitation } from '@crossfire/domain/member/invitation';
import { value } from './application.js';
import { checkPaperLayout } from '../../tools/browser/layout.js';

async function configure(page: Page, origin: string, signup: 'open' | 'invitation', issuers: 'members' | 'administrators') {
  await page.goto(origin + '/manage/policy');
  await page.getByLabel('Who can sign up?', { exact: true }).selectOption(signup);
  await page.getByLabel('Who can invite members?', { exact: true }).selectOption(issuers);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Save settings', exact: true }).click()]);
  await expect(page.getByLabel('Who can sign up?', { exact: true })).toHaveValue(signup);
  await expect(page.getByLabel('Who can invite members?', { exact: true })).toHaveValue(issuers);
}

export async function checkOnboardingPolicy(page: Page, memberPage: Page, origin: string, services: Services, actor: Actor) {
  await configure(page, origin, 'open', 'members');
  await memberPage.goto(origin + '/manage/invitations');
  await expect(memberPage.getByRole('link', { name: 'Invitations', exact: true })).toBeVisible();
  await expect(memberPage.getByLabel('Role', { exact: true }).locator('option')).toHaveCount(1);
  await expect(memberPage.getByLabel('Role', { exact: true })).toHaveValue('member');
  await memberPage.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(memberPage.getByLabel('Share this private link once')).toBeVisible();
  await expect(memberPage.locator('tbody tr')).toHaveCount(1);
  await checkPaperLayout(memberPage);
  for (let index = 0; index < 21; index++) value(createMemberInvitation(services, actor, { roleCode: 'member', expiresSeconds: 600 }, randomUUID()));
  await page.goto(origin + '/manage/invitations?pageSize=10');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  const first = await page.locator('tbody tr td:first-child').allTextContents();
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  const second = await page.locator('tbody tr td:first-child').allTextContents();
  assert.equal(first.filter(id => second.includes(id)).length, 0, 'Ordered pagination has no repeated items');
  assert.equal(new URL(page.url()).searchParams.get('pageSize'), '10');
  await page.reload();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  await expect(page.locator('tbody tr td:first-child')).toHaveText(second);
  await page.getByRole('link', { name: 'Last', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('3');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByLabel('Page number', { exact: true }).fill('1');
  await page.getByLabel('Page number', { exact: true }).press('Enter');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  await page.getByLabel('Rows per page', { exact: true }).selectOption('20');
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await checkPaperLayout(page);
  await page.goto(origin + '/manage/audit?pageSize=10');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  const recent = await page.locator('tbody tr').allTextContents();
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('2');
  assert.notDeepEqual(await page.locator('tbody tr').allTextContents(), recent);
  await checkPaperLayout(page);
  const signupContext = await page.context().browser()!.newContext();
  try {
    const signup = await signupContext.newPage();
    await signup.goto(origin + '/#/register');
    await signup.getByLabel('Username', { exact: true }).fill('open-reader');
    await signup.getByLabel('Password', { exact: true }).fill('open-fixture-password');
    await signup.getByLabel('Confirm password', { exact: true }).fill('open-fixture-password');
    await signup.getByRole('button', { name: 'Register', exact: true }).click();
    const opened = signup.waitForEvent('popup');
    await signup.getByRole('button', { name: 'Start authentication', exact: true }).click();
    const confirmation = await opened;
    await expect(confirmation.getByRole('heading', { name: 'Confirm your account', exact: true })).toBeVisible();
    const completion = signup.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/_matrix/client/v3/register');
    await confirmation.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(confirmation.getByRole('heading', { name: 'Account confirmed', exact: true })).toBeVisible();
    const response = await completion;
    assert.equal(response.status(), 200, await response.text());
    assert.equal((await response.json() as { user_id: string }).user_id, '@open-reader:' + services.instance.serverName);
    const principal = value(services.directory.principalByMatrixId('@open-reader:' + services.instance.serverName))!;
    assert.equal(value(services.directory.member(principal.id))!.role.roleCode, 'member');
  } finally { await signupContext.close(); }
  await configure(page, origin, 'invitation', 'administrators');
  await memberPage.goto(origin + '/manage/invitations');
  await expect(memberPage.getByRole('link', { name: 'Invitations', exact: true })).toHaveCount(0);
  await expect(memberPage.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible();
  assert.equal((await memberPage.request.get(origin + '/api/member-invitations')).status(), 403);
  assert.equal((await (await memberPage.request.get(origin + '/config.json')).json() as { disable_registration: boolean }).disable_registration, true);
  await page.goto(origin + '/manage/members');
  await expect(page.getByText('open-reader', { exact: true })).toBeVisible();
  await checkPaperLayout(page);
}
