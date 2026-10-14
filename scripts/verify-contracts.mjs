import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { buildProducts, repository, command, products } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';
import { testEvidence } from './test-evidence.mjs';

if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error('Use verify-contracts.mjs /absolute/implementation-matrix.json; every configured target runs the complete shared suite');
const resources = verifyTestResources(), manifest = resolve(process.argv[2]), configuration = JSON.parse(readFileSync(manifest, 'utf8'));
if (!configuration || configuration.schemaVersion !== 1 || Object.keys(configuration).sort().join(',') !== 'schemaVersion,targets' || !Array.isArray(configuration.targets) || configuration.targets.length < 1 || configuration.targets.length > 16) throw new Error('Use schemaVersion 1 with an explicit nonempty implementation matrix');
const names = new Set(), implementations = new Set();
for (const target of configuration.targets) {
  if (!target || Object.keys(target).sort().join(',') !== 'cli,daemon,implementation,name,server' || !/^[a-z][a-z0-9-]{0,63}$/u.test(target.name) || names.has(target.name) || !['node', 'csharp', 'rust'].includes(target.implementation)) throw new Error('Invalid or duplicate implementation target');
  names.add(target.name); implementations.add(target.implementation);
  for (const product of ['server', 'daemon', 'cli']) {
    const value = target[product]; if (!value || Object.keys(value).sort().join(',') !== 'arguments,binary' || !isAbsolute(value.binary) || !Array.isArray(value.arguments) || value.arguments.some(item => typeof item !== 'string' || item.includes('\0'))) throw new Error('Use an explicit executable/argument vector for ' + target.name + '/' + product);
    accessSync(value.binary, constants.X_OK);
  }
}
if (!implementations.has('node')) throw new Error('Include the Node reference for direct same-file interoperability');
if (implementations.has('csharp') && (!configuration.targets.some(target => target.name === 'csharp-managed' && target.implementation === 'csharp') || !configuration.targets.some(target => target.name === 'csharp-nativeaot' && target.implementation === 'csharp'))) throw new Error('C# verification requires both managed and actual NativeAOT targets');
await buildProducts(products);
await command(process.execPath, ['dist/scripts/architecture-proof/conduit-assets.js'], join(repository, 'services/crossfire'));
await command(process.execPath, ['dist/scripts/architecture-proof/pi-assets.js'], join(repository, 'services/crossfire'));
const evidence = join(repository, '.temp/contract-runs', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid); mkdirSync(evidence, { recursive: true });
const jobs = configuration.targets, results = []; let next = 0; const workers = Math.min(availableParallelism(), jobs.length);
await Promise.all(Array.from({ length: workers }, async () => {
  for (;;) {
    const target = jobs[next++]; if (!target) return; const started = performance.now(), log = join(evidence, target.name + '.log'), output = testEvidence(log);
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=840000', join(repository, 'scripts/contract-worker.mjs')], { cwd: repository, env: { ...process.env, CROSSFIRE_CONTRACT_MATRIX: manifest, CROSSFIRE_CONTRACT_TARGET: target.name }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let expired = false, escalation;
    function stop(signal) { if (child.pid !== undefined) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    const timer = setTimeout(() => { expired = true; stop('SIGTERM'); escalation = setTimeout(() => stop('SIGKILL'), 5000); }, 900000);
    child.stdout.on('data', bytes => output.append('stdout', bytes)); child.stderr.on('data', bytes => output.append('stderr', bytes));
    const failure = await new Promise(resolveExit => { child.once('error', error => resolveExit(error.message)); child.once('close', (code, signal) => resolveExit(expired ? 'Contract deadline exceeded' : code === 0 ? null : String(signal ?? code))); }); clearTimeout(timer); clearTimeout(escalation);
    const { tail, ...counts } = output.finish(); const result = { target: target.name, implementation: target.implementation, elapsedMs: Math.round(performance.now() - started), failure: failure ?? (!counts.complete || counts.failed || counts.cancelled ? 'Incomplete or failed shared contract assertions' : null), log, ...counts }; results.push(result); console.log((result.failure ? 'FAIL ' : 'PASS ') + target.name); if (result.failure) console.error(tail);
  }
}));
writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ resources, workers, manifest, assertions: 'one shared contract suite', results }, null, 2) + '\n');
if (results.some(result => result.failure)) throw new Error('Unified contract matrix failed; inspect ' + evidence);
console.log(JSON.stringify({ status: 'passed', implementations: [...implementations], targets: [...names], evidence }));
