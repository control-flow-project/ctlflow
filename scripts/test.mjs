import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProducts, repository, products, command } from './build.mjs';
import { testOptions, runtimeTestEnabled } from './test-options.mjs';

const browserFiles = new Set(['browser.test.js', 'fleet-browser.test.js', 'wake-up-browser.test.js']);

export async function runTests(selected, selection, options = { allRuntimes: false }) {
  if (!['all', 'browser', 'integration'].includes(selection)) throw new Error('Select an existing test suite');
  const discovered = selected.flatMap(service => {
    const root = join(repository, 'services', service), output = join(root, 'dist');
    return ['tests', ...(service === 'crossfire' ? ['scripts'] : [])].flatMap(directory =>
      readdirSync(join(output, directory), { recursive: true }).filter(file => {
        const browser = directory === 'tests' && browserFiles.has(file), integration = file.endsWith('.integration.js');
        return selection === 'browser' ? browser : selection === 'integration' ? integration : file.endsWith('.test.js') || integration;
      }).map(file => ({ service, root, file: join(output, directory, file), label: service + '/' + directory + '/' + file })));
  });
  const jobs = discovered.filter(job => runtimeTestEnabled(job.file, options));
  if (!jobs.length) throw new Error('No tests matched the selected products and suite');
  const concurrency = Math.min(availableParallelism(), jobs.length), started = performance.now();
  const evidence = join(repository, '.temp/test-runs', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
  mkdirSync(evidence, { recursive: true });
  if (jobs.some(job => job.service === 'crossfire' && browserFiles.has(basename(job.file)))) {
    const root = join(repository, 'services/crossfire');
    await command(process.execPath, [join(root, 'dist/tests/support/element.js')], root);
  }
  const preparationMs = Math.round(performance.now() - started);
  let next = 0;
  const results = [];
  const runtimes = options.allRuntimes ? ['codex', 'claude', 'pi'] : ['codex'];
  console.log('Runtime test suites: ' + runtimes.join(', ') + '; ' + (discovered.length - jobs.length) + ' optional runtime files excluded. Use --all-runtimes to include Claude and Pi.');
  console.log('Running ' + jobs.length + ' isolated test files on ' + concurrency + ' parallel workers. Logs: ' + evidence);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const job = jobs[next++]; if (!job) return;
      const before = performance.now(), log = join(evidence, job.label.replaceAll('/', '__') + '.log');
      const child = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=180000', job.file], { cwd: job.root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let expired = false, escalation;
      function stop(signal) {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      const deadline = setTimeout(() => {
        expired = true; stop('SIGTERM'); escalation = setTimeout(() => stop('SIGKILL'), 5000);
      }, 300000);
      child.stdout.on('data', bytes => { output += String(bytes); }); child.stderr.on('data', bytes => { output += String(bytes); });
      const failure = await new Promise(resolve => {
        child.once('error', error => resolve(error.message));
        child.once('close', (code, signal) => resolve(expired ? 'File/cleanup deadline exceeded' : code === 0 ? null : String(signal ?? code)));
      });
      clearTimeout(deadline); clearTimeout(escalation);
      writeFileSync(log, output);
      const result = { file: job.label, elapsedMs: Math.round(performance.now() - before), failure, log };
      results.push(result);
      console.log((failure ? 'FAIL ' : 'PASS ') + job.label + ' (' + (result.elapsedMs / 1000).toFixed(2) + 's)');
      if (failure) console.error(output);
    }
  }));
  const summary = { runtimes, workers: concurrency, preparationMs, elapsedMs: Math.round(performance.now() - started), files: results.sort((left, right) => right.elapsedMs - left.elapsedMs) };
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const totals = results.map(result => readFileSync(result.log, 'utf8')).reduce((total, log) => {
    total.tests += Number(/^ℹ tests (\d+)$/mu.exec(log)?.[1] ?? 0);
    total.failed += Number(/^ℹ fail (\d+)$/mu.exec(log)?.[1] ?? 0);
    total.cancelled += Number(/^ℹ cancelled (\d+)$/mu.exec(log)?.[1] ?? 0); return total;
  }, { tests: 0, failed: 0, cancelled: 0 });
  console.log(JSON.stringify({ ...totals, runtimes, files: results.length, workers: concurrency, preparationMs, elapsedMs: summary.elapsedMs, evidence }));
  if (results.some(result => result.failure)) throw new Error('Test failures; inspect the per-file evidence');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = process.argv[2], selection = process.argv[3] ?? 'all';
  if (!products.includes(service)) throw new Error('Select an existing product');
  const options = testOptions(process.argv.slice(4));
  await buildProducts([service]); await runTests([service], selection, options);
}
