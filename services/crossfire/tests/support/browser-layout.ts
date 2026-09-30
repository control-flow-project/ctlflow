import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';

export async function checkPaperLayout(page: Page): Promise<void> {
  await expect(page.locator('.page-frame')).toHaveCount(1);
  await expect(page.locator('.page-heading h1')).toBeVisible();
  const geometry = await page.evaluate<{ width: number; border: string; headingPadding: string; bodyPadding: string; headingRight: number; bodyRight: number }>(`(() => {
    const frame = document.querySelector('.page-frame');
    const heading = frame.querySelector('.page-heading');
    const body = frame.querySelector('.page-body');
    return { width: innerWidth, border: getComputedStyle(frame).borderLeftWidth,
      headingPadding: getComputedStyle(heading).paddingLeft, bodyPadding: getComputedStyle(body).paddingLeft,
      headingRight: heading.getBoundingClientRect().right, bodyRight: body.getBoundingClientRect().right };
  })()`);
  if (geometry.width > 700) assert.equal(geometry.border, '1px', 'Retain the outer page frame');
  assert.equal(geometry.headingPadding, geometry.bodyPadding, 'Use the same heading and body gutter');
  assert.equal(geometry.headingRight, geometry.bodyRight);
  assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'), page.url());
  const layers = await page.evaluate<{ name: string; left: string; right: string; radius: string }[]>(`Array.from(
    document.querySelectorAll('.panel, .filter-bar, .empty, .quiet-note, .table-wrap, .agent-card')
  ).filter(element => element.getBoundingClientRect().width > 0).map(element => {
    const style = getComputedStyle(element);
    return { name: element.className, left: style.borderLeftWidth, right: style.borderRightWidth, radius: style.borderRadius };
  })`);
  for (const layer of layers) {
    assert.equal(layer.left, '0px', layer.name + ' must not enclose another box');
    assert.equal(layer.right, '0px', layer.name + ' must not enclose another box');
    assert.equal(layer.radius, '0px', layer.name + ' uses document sections, not cards');
  }
  const controls = await page.evaluate<string[]>(`Array.from(document.querySelectorAll(
    '.page-frame input:not([type=checkbox]), .page-frame select, .page-frame textarea, .page-frame .alert'
  )).filter(element => element.getBoundingClientRect().width > 0).map(element => getComputedStyle(element).borderLeftWidth)`);
  for (const border of controls) assert.equal(border, '1px', 'Input and alert boundaries remain visible');
  await expect(page.locator('.eyebrow, .empty-mark, .sidebar-note, .page-footer')).toHaveCount(0);
  const copy = await page.locator('body').innerText();
  for (const slogan of ['YOUR COORDINATION SPACE', 'Your team, under your control', 'HUMANS IN CHARGE',
    'Your say.', 'Human-led coordination', 'The conversation belongs to everyone.',
    'The controls belong to you.', 'Explicit access. Human ownership.', 'Make yourself at home.',
    'You’re in.', 'Let’s get you back', 'A fresh start', 'welcome your first teammate']) {
    assert(!copy.includes(slogan), 'Functional UI copy must not contain: ' + slogan);
  }
}
