import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { repository } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';
import { testEvidence } from './test-evidence.mjs';
import { readContractMatrix } from './contract-targets.mjs';

export async function runContractTargets({ manifest, worker, bank, testTimeoutMs = 840000, deadlineMs = 900000, cleanupMs = 5000, environment = {}, signal }) {
  if (!isAbsolute(worker) || !['contract-runs', 'container-runs'].includes(bank)
    || ![testTimeoutMs, deadlineMs, cleanupMs].every(value => Number.isSafeInteger(value) && value > 0)
    || testTimeoutMs >= deadlineMs) throw new Error('Use an absolute worker, a known contract bank and finite ordered deadlines');
  const resources = verifyTestResources(), targets = readContractMatrix(manifest);
  const evidence = join(repository, '.temp', bank, new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const results = [], workers = Math.min(availableParallelism(), targets.length); let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const target = targets[next++]; if (!target) return;
      const started = performance.now(), log = join(evidence, target.name + '.log'), output = testEvidence(log);
      const childEnvironment = { ...process.env, ...environment, CROSSFIRE_CONTRACT_MATRIX: manifest, CROSSFIRE_CONTRACT_TARGET: target.name };
      delete childEnvironment.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=' + testTimeoutMs, worker], {
        cwd: repository, env: childEnvironment,
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let expired = false, cancelled = false, escalation;
      function stop(selected) {
        if (child.pid !== undefined) try { process.kill(-child.pid, selected); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      function terminate() { stop('SIGTERM'); escalation ??= setTimeout(() => stop('SIGKILL'), cleanupMs); }
      const cancel = () => { cancelled = true; terminate(); };
      const timer = setTimeout(() => { expired = true; terminate(); }, deadlineMs);
      signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
      child.stdout.on('data', bytes => output.append('stdout', bytes)); child.stderr.on('data', bytes => output.append('stderr', bytes));
      const failure = await new Promise(resolveExit => {
        child.once('error', error => resolveExit(error.message));
        child.once('close', (code, endedBy) => resolveExit(cancelled ? 'Contract verification cancelled' : expired ? 'Contract deadline exceeded' : code === 0 ? null : String(endedBy ?? code)));
      });
      clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener('abort', cancel);
      const { tail, ...counts } = output.finish();
      const result = { target: target.name, implementation: target.implementation, elapsedMs: Math.round(performance.now() - started),
        failure: failure ?? (!counts.complete || !counts.tests || counts.failed || counts.cancelled ? 'Incomplete or failed shared contract assertions' : null), log, ...counts };
      results.push(result); console.log((result.failure ? 'FAIL ' : 'PASS ') + target.name); if (result.failure) console.error(tail);
    }
  }));
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ resources, workers, manifest, assertions: 'one shared contract suite', results }, null, 2) + '\n');
  if (results.length !== targets.length || results.some(result => result.failure)) throw new Error('Unified contract matrix failed; inspect ' + evidence);
  const result = { status: 'passed', implementations: [...new Set(targets.map(target => target.implementation))], targets: targets.map(target => target.name), evidence };
  console.log(JSON.stringify(result)); return result;
}
