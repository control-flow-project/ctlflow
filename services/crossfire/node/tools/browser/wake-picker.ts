import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import { checkPaperLayout } from './layout.js';

export async function verifyWakePicker(page: Page, agentId: string, viewport: { width: number; height: number }, screenshot: string): Promise<void> {
  const path = '/api/agents/' + agentId + '/wake-policy';
  async function read() {
    const response = await page.request.get(new URL(path, page.url()).href);
    assert.equal(response.status(), 200, 'Wake policy is readable by its authorized operator');
    const parsed = decodeResponse(await response.json(), operations.wakePolicy.output, false);
    assert(parsed.ok, 'Wake policy uses the current structured contract');
    return parsed.value.data;
  }
  const before = await read();
  const open = page.getByRole('link', { name: 'Choose who can wake', exact: true });
  await open.click();
  await expect(page).toHaveURL(new URL('/manage/agents/' + agentId + '/wake', page.url()).href);
  await page.reload();
  const editor = page.locator('#wake-editor');
  await expect(editor).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(editor.getByLabel('Audience', { exact: true })).toHaveValue(before.mode);
  await expect(editor.getByLabel('Audience', { exact: true }).locator('option')).toHaveCount(3);
  await expect(editor.getByRole('button', { name: 'Save wake-up policy', exact: true })).toBeDisabled();
  assert.equal((await page.evaluate<number>('innerWidth')), viewport.width, 'The intended wake-page viewport is in use');
  await checkPaperLayout(page);
  await page.screenshot({ path: screenshot });
  await editor.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(open).toBeVisible();
  assert.equal(JSON.stringify(await read()), JSON.stringify(before), 'Inspecting and cancelling the picker does not change authority');
}
