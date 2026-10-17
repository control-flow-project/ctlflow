import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { contractStack } from '../contracts/fixture.js';
import { populatePerformanceHistory } from './fixture.js';
import { performanceTransport, type PerformanceRequest } from './transport.js';
import { comparePerformance, type Measurement, type PerformanceReport } from './statistics.js';
import { performanceHtml } from './report.js';

export async function serverPerformance(scope: TestContext, targets: readonly ContractTarget[], output: string,
  provenance: Pick<PerformanceReport, 'source' | 'host'>): Promise<void> {
  const baseline = targets.find(target => target.implementation === 'node');
  assert(baseline && targets.some(target => target.name === 'csharp-managed') && targets.some(target => target.name === 'csharp-nativeaot')
    && targets.some(target => target.implementation === 'rust'), 'Performance verification requires Node, .NET managed/NativeAOT and Rust');
  mkdirSync(output, { mode: 0o700 });
  const measurements: Measurement[] = [], policy = { rounds: targets.length, samples: 100, warmup: 20, baseline: baseline.name };
  let fixture = { agents: 0, listenerRuns: 0, runtimeObservations: 0 };
  let problem: string | null = null;
  try {
    const platform = await contractStack(scope, baseline, targets);
    const agent = await platform.agent('performance-analyst');
    await platform.close();
    fixture = populatePerformanceHistory(join(platform.state, 'management.sqlite'), agent.id);
    for (let round = 0; round < policy.rounds; round++) {
      const order = [...targets.slice(round), ...targets.slice(0, round)];
      for (const target of order) {
        await platform.restart(target);
        scope.signal.throwIfAborted();
        const connectionId = randomUUID(), client = performanceTransport(platform.origin, scope.signal);
        const heartbeat: PerformanceRequest = { ...operations.reportFleetConnection,
          path: operations.reportFleetConnection.path.replace('{fleetId}', agent.fleetId).replace('{connectionId}', connectionId),
          body: { stopped: false }, headers: { Authorization: 'Bearer ' + agent.credential } };
        const workloads = [
          ['Session', operations.currentSession, '/api/sessions/current'],
          ['Policy', operations.policy, '/api/instance-policy'],
          ['Agent directory · 50,000 histories', operations.agents, '/api/agents?pageSize=20'],
          ['Fleet directory · 50 agents', operations.fleets, '/api/fleets?pageSize=20'],
          ['Saved runtime observations', operations.runtimeObservations, '/api/agents/' + agent.id + '/runtime-observations'],
        ] as const;
        try {
          assert.equal((await client.call(heartbeat)).failure, null, 'Controller admission');
          for (const [workload, operation, path] of workloads) {
            assert.equal((await client.call(heartbeat)).failure, null, 'Controller lease before workload');
            const request: PerformanceRequest = { ...operation, path, headers: { Cookie: platform.owner.cookie } };
            for (let warm = 0; warm < policy.warmup; warm++) {
              scope.signal.throwIfAborted();
              assert.equal((await client.call(request)).failure, null, 'Warm-up must use successful full responses');
            }
            const result: Measurement = { target: target.name, workload, round, concurrency: 1, samplesMs: [], failures: [], elapsedMs: 0 };
            const started = performance.now();
            for (let sample = 0; sample < policy.samples; sample++) {
              scope.signal.throwIfAborted();
              const response = await client.call(request); result.samplesMs.push(response.elapsedMs);
              if (response.failure !== null) result.failures.push(response.failure);
            }
            result.elapsedMs = performance.now() - started; measurements.push(result);
            scope.diagnostic(target.name + ' / ' + workload + ' / round ' + (round + 1) + ': ' + result.elapsedMs.toFixed(1) + ' ms, ' + result.failures.length + ' failures');
          }
          const concurrent: Measurement = { target: target.name, workload: 'Concurrent UI reads + controller heartbeats', round, concurrency: 8, samplesMs: [], failures: [], elapsedMs: 0 };
          const started = performance.now();
          await Promise.all(Array.from({ length: concurrent.concurrency }, async (_unused, worker) => {
            const request: PerformanceRequest = worker === 0 ? heartbeat : { ...operations.agents, path: '/api/agents?pageSize=20', headers: { Cookie: platform.owner.cookie } };
            for (let sample = 0; sample < 25; sample++) {
              scope.signal.throwIfAborted();
              const response = await client.call(request); concurrent.samplesMs.push(response.elapsedMs);
              if (response.failure !== null) concurrent.failures.push(response.failure);
            }
          }));
          concurrent.elapsedMs = performance.now() - started; measurements.push(concurrent);
          assert.equal((await client.call({ ...heartbeat, body: { stopped: true } })).failure, null, 'Close only this performance controller generation');
        } finally { client.close(); await platform.close(); }
      }
    }
  } catch (error) { problem = error instanceof Error ? error.message : String(error); }
  let comparisons: PerformanceReport['comparisons'] = [];
  try { comparisons = comparePerformance(measurements, baseline.name); }
  catch (error) { problem ??= error instanceof Error ? error.message : String(error); }
  const complete = measurements.length === policy.rounds * targets.length * 6;
  const passed = problem === null && complete && comparisons.every(value => value.passed);
  const report: PerformanceReport = { schemaVersion: 1, generatedAt: new Date().toISOString(), ...provenance, fixture, policy,
    targets: targets.map(target => ({ name: target.name, implementation: target.implementation })), measurements, comparisons, passed, problem };
  writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(output, 'report.html'), performanceHtml(report), { mode: 0o600 });
  scope.diagnostic('Performance HTML and JSON: ' + output);
  assert.equal(problem, null, 'Performance setup and requests must complete');
  assert.equal(complete, true, 'Every runtime must complete every rotated workload');
  assert.equal(passed, true, 'Every workload must meet measured Node p50, p95 and throughput with zero failures; inspect report.html');
}
