import { expect, type Page } from '@playwright/test';

export async function decideConfirmation(page: Page, label = 'Cancel') {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label, exact: true }).click();
}
