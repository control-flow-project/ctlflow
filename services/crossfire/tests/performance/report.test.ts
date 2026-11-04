import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePerformance, percentile, type Measurement, type PerformanceReport } from './statistics.js';
import { performanceHtml } from './report.js';

const measurement = (target: string, times: number[], failures: string[] = []): Measurement => ({ target, workload: 'Read', round: 0, concurrency: 1, samplesMs: times, elapsedMs: times.reduce((sum, value) => sum + value, 0), failures });

test('performance statistics retain slow samples and request failures without a speed threshold', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2); assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.throws(() => percentile([], 0.5)); assert.throws(() => percentile([Number.NaN], 0.5));
  const values = summarizePerformance([measurement('fast', [1, 2, 3]), measurement('slow', [300, 400, 500]), measurement('failed', [1, 2, 3], ['HTTP 503'])]);
  assert.equal(values.find(value => value.target === 'fast')!.p50Ms, 2);
  assert.equal(values.find(value => value.target === 'slow')!.p50Ms, 400);
  assert.equal(values.find(value => value.target === 'slow')!.failures, 0);
  assert.equal(values.find(value => value.target === 'failed')!.failures, 1);
});

test('round summaries use median round percentiles and count every attempted request', () => {
  const rounds = [[1, 2, 3], [100, 200, 300], [10, 20, 30]].map((times, round) => ({ ...measurement('native', times), round }));
  const [value] = summarizePerformance(rounds);
  assert.equal(value!.samples, 9); assert.equal(value!.p50Ms, 20); assert.equal(value!.p95Ms, 30);
  assert.equal(value!.p99Ms, 30); assert.equal(value!.requestsPerSecond, 50);
  assert.deepEqual(summarizePerformance([]), []);
  for (const invalid of [{ ...rounds[0]!, samplesMs: [] }, { ...rounds[0]!, elapsedMs: 0 }, { ...rounds[0]!, elapsedMs: Infinity }])
    assert.throws(() => summarizePerformance([invalid]), /samples and positive elapsed/u);
});

test('a performance HTML report escapes all text and loads no active or external content', () => {
  const measurements = [measurement('native', [2, 3]), measurement('<script>native</script>', [1, 2], ['<img src=x onerror=alert(1)>'])];
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: '2026-11-04', source: { commit: 'candidate', dirty: true }, host: { platform: 'linux', architecture: 'x64', processors: 8, resources: {} },
    fixture: { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 }, policy: { rounds: 1, samples: 2, warmup: 1 },
    targets: [{ name: 'native', implementation: 'native' }, { name: '<script>native</script>', implementation: 'native' }], measurements,
    summaries: summarizePerformance(measurements), passed: false, problem: null };
  const html = performanceHtml(report);
  assert(html.includes('&lt;script&gt;native&lt;/script&gt;')); assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!/<script\b|<iframe\b|<link\b|<img\b|https?:\/\//iu.test(html));
  assert(html.includes('Measurement failed')); assert(html.includes('50,000')); assert(html.includes('Content-Security-Policy'));
});

test('successful slow targets have no reference limits or comparison verdict in the report', () => {
  const measurements = [measurement('csharp-nativeaot', [1, 2]), measurement('rust', [100, 200])];
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: '2026-11-04', source: { commit: 'candidate', dirty: false }, host: { platform: 'linux', architecture: 'x64', processors: 8, resources: {} },
    fixture: { agents: 50, listenerRuns: 50000, runtimeObservations: 50000 }, policy: { rounds: 1, samples: 2, warmup: 1 },
    targets: measurements.map(value => ({ name: value.target, implementation: value.target })), measurements,
    summaries: summarizePerformance(measurements), passed: true, problem: null };
  const html = performanceHtml(report);
  assert.match(html, /Measurement completed/u); assert.match(html, /All measured requests succeeded/u);
  assert.match(html, /not pass\/fail thresholds/u);
  assert.doesNotMatch(html, /Meets reference baseline|vs NativeAOT|minimum throughput|performance gates/iu);
});
