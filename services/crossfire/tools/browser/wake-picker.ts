import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';

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
  const open = page.getByRole('button', { name: 'Choose who can wake', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Who can wake this agent?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Audience')).toHaveValue(before.mode);
  await expect(dialog.getByLabel('Audience').locator('option')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: 'Save wake-up policy', exact: true })).toBeDisabled();
  const bounds = await dialog.boundingBox();
  assert(bounds, 'Wake picker has visible modal bounds');
  assert(bounds.width <= viewport.width && bounds.height <= viewport.height, 'Wake picker fits the viewport');
  if (viewport.width <= 640) {
    assert.equal(Math.round(bounds.width), viewport.width, 'Mobile picker fills the viewport width');
    assert.equal(Math.round(bounds.height), viewport.height, 'Mobile picker fills the viewport height');
  }
  await page.keyboard.press('Tab');
  assert(await page.evaluate<boolean>('document.querySelector("dialog").contains(document.activeElement)'), 'Keyboard focus remains inside the modal');
  await page.screenshot({ path: screenshot });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  assert.equal(JSON.stringify(await read()), JSON.stringify(before), 'Inspecting and cancelling the picker does not change authority');
}
