import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePerformance, percentile, type Measurement, type PerformanceReport } from './statistics.js';
import { performanceHtml } from './report.js';

const measurement = (target: string, times: number[], failures: string[] = []): Measurement => ({ target, workload: 'Read', round: 0, concurrency: 1, samplesMs: times, elapsedMs: times.reduce((sum, value) => sum + value, 0), failures });

test('performance statistics retain slow samples, errors and strict Node regression gates', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2); assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.throws(() => percentile([], 0.5)); assert.throws(() => percentile([Number.NaN], 0.5));
  const values = comparePerformance([measurement('node', [2, 3, 4]), measurement('native', [1, 2, 3]), measurement('slow', [3, 4, 5]), measurement('failed', [1, 2, 3], ['HTTP 503'])], 'node');
  assert.equal(values.find(value => value.target === 'native')!.passed, true);
  assert.equal(values.find(value => value.target === 'slow')!.passed, false);
  assert.equal(values.find(value => value.target === 'failed')!.passed, false);
  assert.throws(() => comparePerformance([measurement('native', [1])], 'node'), /baseline/u);
});

test('only managed saved-observation median and p95 have the explicit thirty-percent exception', () => {
  const baseline = { ...measurement('node', [...Array<number>(18).fill(2), 4, 4]), workload: 'Saved runtime observations' };
  const comparison = (target = 'csharp-managed', tail = 5.2, workload = baseline.workload, median = 2.6) =>
    ({ ...measurement(target, [...Array<number>(18).fill(median), tail, tail]), workload, elapsedMs: 20 });
  const accepted = comparePerformance([baseline, comparison()], 'node')[1]!;
  assert.equal(accepted.maximumMedianRatio, 1.3); assert.equal(accepted.medianRatio, 1.3);
  assert.equal(accepted.maximumTailRatio, 1.3); assert.equal(accepted.tailRatio, 1.3); assert.equal(accepted.passed, true);
  assert.equal(comparePerformance([baseline, comparison('csharp-managed', 5.2001)], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, comparison('csharp-managed', 4, baseline.workload, 2.6001)], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, comparison('csharp-managed', 4)], 'node')[1]!.passed, true);
  assert.equal(comparePerformance([baseline, comparison('csharp-managed', 5.2, baseline.workload, 1)], 'node')[1]!.passed, true);
  assert.equal(comparePerformance([baseline, comparison('csharp-nativeaot')], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, comparison('rust')], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, comparison('csharp-nativeaot', 4)], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, comparison('rust', 4)], 'node')[1]!.passed, false);
  const other = comparePerformance([{ ...baseline, workload: 'Policy' }, comparison('csharp-managed', 5.2, 'Policy')], 'node')[1]!;
  assert.equal(other.maximumMedianRatio, 1); assert.equal(other.maximumTailRatio, 1); assert.equal(other.passed, false);
  assert.equal(comparePerformance([{ ...baseline, workload: 'Policy' }, comparison('csharp-managed', 4, 'Policy')], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, { ...comparison(), elapsedMs: baseline.elapsedMs * 2 }], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([baseline, { ...comparison(), failures: ['HTTP 503'] }], 'node')[1]!.passed, false);
  assert.equal(comparePerformance([{ ...baseline, failures: ['HTTP 503'] }, comparison()], 'node')[1]!.passed, false);
});

test('a performance HTML report escapes all text and loads no active or external content', () => {
  const measurements = [measurement('node', [2, 3]), measurement('<script>native</script>', [1, 2], ['<img src=x onerror=alert(1)>'])];
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: '2026-10-18', source: { commit: 'candidate', dirty: true }, host: { platform: 'linux', architecture: 'x64', processors: 8, resources: {} },
    fixture: { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 }, policy: { rounds: 1, samples: 2, warmup: 1, baseline: 'node' },
    targets: [{ name: 'node', implementation: 'node' }, { name: '<script>native</script>', implementation: 'native' }], measurements,
    comparisons: comparePerformance(measurements, 'node'), passed: false, problem: null };
  const html = performanceHtml(report);
  assert(html.includes('&lt;script&gt;native&lt;/script&gt;')); assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!/<script\b|<iframe\b|<link\b|<img\b|https?:\/\//iu.test(html));
  assert(html.includes('Performance gates failed')); assert(html.includes('50,000')); assert(html.includes('Content-Security-Policy'));
});
