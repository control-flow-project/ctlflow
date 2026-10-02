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
  const rows = await page.evaluate<{ alignment: string; offset: number | null; margins: string[] }[]>(`Array.from(document.querySelectorAll('table td'))
    .filter(cell => cell.getBoundingClientRect().height > 0).map(cell => {
      const outer = cell.getBoundingClientRect();
      const controls = Array.from(cell.querySelectorAll(':scope > select, :scope > .actions, :scope > .status'))
        .filter(control => control.getBoundingClientRect().height > 0);
      const content = Array.from(cell.childNodes).flatMap(node => {
        if (node instanceof Element) {
          const bounds = node.getBoundingClientRect();
          return bounds.height > 0 ? [bounds] : [];
        }
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return [];
        const range = document.createRange();
        range.selectNode(node);
        const bounds = range.getBoundingClientRect();
        return bounds.height > 0 ? [bounds] : [];
      });
      return { alignment: getComputedStyle(cell).verticalAlign,
        offset: controls.length > 0 && content.length > 0 ? Math.abs((Math.min(...content.map(bounds => bounds.top))
          + Math.max(...content.map(bounds => bounds.bottom)) - outer.top - outer.bottom) / 2) : null,
        margins: controls.map(control => getComputedStyle(control).marginTop)
      };
    })`);
  for (const row of rows) {
    assert.equal(row.alignment, 'middle', 'Every table cell uses one vertical alignment');
    for (const margin of row.margins) assert.equal(margin, '0px', 'Table controls do not carry surrounding form margins');
    if (row.offset !== null) assert(row.offset <= 1, 'Table content shares the row’s vertical center: ' + row.offset);
  }
  const paginationLabels = await page.evaluate<string[]>(`Array.from(document.querySelectorAll('.pagination label'))
    .filter(label => label.getBoundingClientRect().width > 0).map(label => getComputedStyle(label).flexDirection)`);
  for (const direction of paginationLabels) assert.equal(direction, 'row', 'Pagination labels and controls remain horizontally aligned');
  await expect(page.locator('.eyebrow, .empty-mark, .sidebar-note, .page-footer')).toHaveCount(0);
  const copy = await page.locator('body').innerText();
  for (const slogan of ['YOUR COORDINATION SPACE', 'Your team, under your control', 'HUMANS IN CHARGE',
    'Your say.', 'Human-led coordination', 'The conversation belongs to everyone.',
    'The controls belong to you.', 'Explicit access. Human ownership.', 'Make yourself at home.',
    'You’re in.', 'Let’s get you back', 'A fresh start', 'welcome your first teammate']) {
    assert(!copy.includes(slogan), 'Functional UI copy must not contain: ' + slogan);
  }
}
