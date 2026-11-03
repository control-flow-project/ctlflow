import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePerformance, percentile, type Measurement, type PerformanceReport } from './statistics.js';
import { performanceHtml } from './report.js';

const measurement = (target: string, times: number[], failures: string[] = []): Measurement => ({ target, workload: 'Read', round: 0, concurrency: 1, samplesMs: times, elapsedMs: times.reduce((sum, value) => sum + value, 0), failures });

test('performance statistics retain slow samples, errors and strict reference regression gates', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2); assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.throws(() => percentile([], 0.5)); assert.throws(() => percentile([Number.NaN], 0.5));
  const values = comparePerformance([measurement('reference', [2, 3, 4]), measurement('native', [1, 2, 3]), measurement('slow', [3, 4, 5]), measurement('failed', [1, 2, 3], ['HTTP 503'])], 'reference');
  assert.equal(values.find(value => value.target === 'native')!.passed, true);
  assert.equal(values.find(value => value.target === 'slow')!.passed, false);
  assert.equal(values.find(value => value.target === 'failed')!.passed, false);
  assert.throws(() => comparePerformance([measurement('native', [1])], 'reference'), /baseline/u);
});

test('every native target and workload has identical strict latency limits', () => {
  const baseline = { ...measurement('reference', [...Array<number>(18).fill(2), 4, 4]), workload: 'Saved runtime observations' };
  for (const target of ['csharp-managed', 'csharp-nativeaot', 'rust']) {
    const comparison = (median = 2, tail = 4) => ({ ...measurement(target, [...Array<number>(18).fill(median), tail, tail]), workload: baseline.workload, elapsedMs: 20 });
    const accepted = comparePerformance([baseline, comparison()], 'reference')[1]!;
    assert.equal(accepted.maximumMedianRatio, 1); assert.equal(accepted.maximumTailRatio, 1); assert.equal(accepted.passed, true);
    for (const candidate of [comparison(2.0001), comparison(2, 4.0001), { ...comparison(), failures: ['HTTP 503'] }])
      assert.equal(comparePerformance([baseline, candidate], 'reference')[1]!.passed, false);
    assert.equal(comparePerformance([{ ...baseline, failures: ['HTTP 503'] }, comparison()], 'reference')[1]!.passed, false);
  }
});

test('a performance HTML report escapes all text and loads no active or external content', () => {
  const measurements = [measurement('reference', [2, 3]), measurement('<script>native</script>', [1, 2], ['<img src=x onerror=alert(1)>'])];
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: '2026-10-18', source: { commit: 'candidate', dirty: true }, host: { platform: 'linux', architecture: 'x64', processors: 8, resources: {} },
    fixture: { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 }, policy: { rounds: 1, samples: 2, warmup: 1, baseline: 'reference' },
    targets: [{ name: 'reference', implementation: 'reference' }, { name: '<script>native</script>', implementation: 'native' }], measurements,
    comparisons: comparePerformance(measurements, 'reference'), passed: false, problem: null };
  const html = performanceHtml(report);
  assert(html.includes('&lt;script&gt;native&lt;/script&gt;')); assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!/<script\b|<iframe\b|<link\b|<img\b|https?:\/\//iu.test(html));
  assert(html.includes('Performance gates failed')); assert(html.includes('50,000')); assert(html.includes('Content-Security-Policy'));
});

test('every native target rejects any throughput regression without an exception', () => {
  const baseline = { ...measurement('reference', [2, 2]), workload: 'Saved runtime observations', elapsedMs: 95 };
  for (const target of ['csharp-managed', 'csharp-nativeaot', 'rust']) {
    const candidate = { ...measurement(target, [2, 2]), workload: baseline.workload, elapsedMs: 95 };
    const accepted = comparePerformance([baseline, candidate], 'reference')[1]!;
    assert.equal(accepted.minimumThroughputRatio, 1); assert.equal(accepted.passed, true);
    assert.equal(comparePerformance([baseline, { ...candidate, elapsedMs: 95.001 }], 'reference')[1]!.passed, false);
    assert.equal(comparePerformance([baseline, { ...candidate, failures: ['HTTP 503'] }], 'reference')[1]!.passed, false);
  }
});
