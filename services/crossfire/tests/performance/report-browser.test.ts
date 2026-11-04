import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { browserOptions } from '@ctlflow/crossfire-test-support/tls';
import { summarizePerformance, type PerformanceReport } from './statistics.js';
import { performanceHtml } from './report.js';

test('performance report is readable offline on desktop and a phone without scripts or network access', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-performance-report-'));
  const measurements = ['csharp-nativeaot', 'csharp-managed', 'rust'].map((target, index) => ({ target, workload: 'Saved runtime observations', round: 0, concurrency: 1,
    samplesMs: target === 'csharp-managed' ? [7, 7, 8] : [5 - index, 6 - index, 7 - index], failures: [], elapsedMs: target === 'csharp-managed' ? 31 : 30 - index * 3 }));
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: '2026-10-18', source: { commit: 'local-browser-fixture', dirty: true },
    host: { platform: 'linux', architecture: 'x64', processors: 8, resources: {} }, fixture: { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 },
    policy: { rounds: 1, samples: 3, warmup: 1 }, targets: measurements.map(value => ({ name: value.target, implementation: value.target })),
    measurements, summaries: summarizePerformance(measurements), passed: true, problem: null };
  const file = join(directory, 'report.html'); writeFileSync(file, performanceHtml(report), { mode: 0o600 });
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage(); const network: string[] = [];
    page.on('request', request => { if (/^https?:/u.test(request.url())) network.push(request.url()); });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(pathToFileURL(file).href);
      await expect(page.getByRole('heading', { name: 'Server performance', exact: true })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(1); await expect(page.getByRole('img')).toHaveCount(3);
      await expect(page.locator('.card')).toHaveCount(3);
      await expect(page.getByText('Measurement completed', { exact: true })).toBeVisible();
      await expect(page.locator('tbody tr td:last-child')).toHaveText(['0', '0', '0']);
      await expect(page.getByRole('columnheader')).toHaveText(['Runtime', 'p50 ms', 'p95 ms', 'p99 ms', 'Requests/s', 'Failures']);
      await expect(page.getByText('All measured requests succeeded', { exact: true })).toHaveCount(3);
      assert(await page.evaluate<boolean>('document.documentElement.scrollWidth <= innerWidth'), 'The report page must not overflow a phone viewport');
      assert.equal(await page.locator('script,iframe,link,img').count(), 0);
    }
    assert.deepEqual(network, []);
  } finally { await browser.close(); rmSync(directory, { recursive: true }); }
});
