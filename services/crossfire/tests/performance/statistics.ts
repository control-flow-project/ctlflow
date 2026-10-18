export type Measurement = {
  target: string; workload: string; round: number; concurrency: number;
  samplesMs: number[]; failures: string[]; elapsedMs: number;
};
export type PerformanceSummary = {
  target: string; workload: string; samples: number; failures: number;
  p50Ms: number; p95Ms: number; p99Ms: number; requestsPerSecond: number;
};
export type PerformanceComparison = PerformanceSummary & {
  medianRatio: number; tailRatio: number; maximumMedianRatio: number; maximumTailRatio: number; throughputRatio: number; passed: boolean;
};
export type PerformanceReport = {
  schemaVersion: 1; generatedAt: string; source: { commit: string; dirty: boolean };
  host: { platform: string; architecture: string; processors: number; resources: Record<string, string> };
  fixture: { agents: number; listenerRuns: number; runtimeObservations: number };
  policy: { rounds: number; samples: number; warmup: number; baseline: string };
  targets: { name: string; implementation: string }[]; measurements: Measurement[];
  comparisons: PerformanceComparison[]; passed: boolean; problem: string | null;
};

export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length || fraction <= 0 || fraction > 1 || values.some(value => !Number.isFinite(value) || value < 0))
    throw new Error('Percentiles require finite nonnegative samples and a fraction in (0, 1]');
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * fraction) - 1]!;
}

export function comparePerformance(measurements: readonly Measurement[], baseline: string): PerformanceComparison[] {
  const groups = new Map<string, Measurement[]>();
  for (const value of measurements) {
    if (!value.samplesMs.length || !Number.isFinite(value.elapsedMs) || value.elapsedMs <= 0)
      throw new Error('Every measurement requires samples and positive elapsed time');
    const key = JSON.stringify([value.target, value.workload]);
    const entries = groups.get(key) ?? []; entries.push(value); groups.set(key, entries);
  }
  const summaries = [...groups.values()].map(entries => ({
    target: entries[0]!.target, workload: entries[0]!.workload,
    samples: entries.reduce((sum, value) => sum + value.samplesMs.length, 0),
    failures: entries.reduce((sum, value) => sum + value.failures.length, 0),
    p50Ms: percentile(entries.map(value => percentile(value.samplesMs, 0.5)), 0.5),
    p95Ms: percentile(entries.map(value => percentile(value.samplesMs, 0.95)), 0.5),
    p99Ms: percentile(entries.map(value => percentile(value.samplesMs, 0.99)), 0.5),
    requestsPerSecond: percentile(entries.map(value => value.samplesMs.length / value.elapsedMs * 1000), 0.5),
  }));
  return summaries.map(value => {
    const reference = summaries.find(candidate => candidate.target === baseline && candidate.workload === value.workload);
    if (!reference || reference.p50Ms <= 0 || reference.p95Ms <= 0) throw new Error('Every workload requires a measured Node baseline');
    const medianRatio = value.p50Ms / reference.p50Ms, tailRatio = value.p95Ms / reference.p95Ms;
    const maximumMedianRatio = value.target === 'csharp-managed' && value.workload === 'Saved runtime observations' ? 1.3 : 1;
    const maximumTailRatio = maximumMedianRatio;
    const throughputRatio = value.requestsPerSecond / reference.requestsPerSecond;
    return { ...value, medianRatio, tailRatio, maximumMedianRatio, maximumTailRatio, throughputRatio,
      passed: reference.failures === 0 && value.failures === 0 && medianRatio <= maximumMedianRatio && tailRatio <= maximumTailRatio && throughputRatio >= 1 };
  });
}
