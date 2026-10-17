import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { repository } from './build.mjs';
import { userManagerEnvironment, verifyTestResources } from './test-resources.mjs';
import { testEvidence } from './test-evidence.mjs';
import { verificationFixtures } from './verification-fixtures.mjs';

if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error('Use verify-parity.mjs /absolute/new-evidence-directory');
const output = resolve(process.argv[2]);
if (existsSync(output) || !existsSync(dirname(output))) throw new Error('Use a new evidence directory with an existing parent');
const resources = verifyTestResources(), events = [];
const fixtures = verificationFixtures();
mkdirSync(output, { mode: 0o700 });
mkdirSync(join(repository, '.temp'), { recursive: true, mode: 0o700 });
const temporary = mkdtempSync(join(repository, '.temp/parity-')), managed = join(temporary, 'managed'), native = join(temporary, 'nativeaot'), rust = join(temporary, 'rust'), matrix = join(temporary, 'matrix.json');
let verified = false;
async function run(label, binary, args, environment = process.env) {
  const started = performance.now(), log = join(output, label + '.log'), evidence = testEvidence(log);
  const child = spawn(binary, args, { cwd: repository, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { evidence.append('stdout', bytes); process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { evidence.append('stderr', bytes); process.stderr.write(bytes); });
  const failure = await new Promise(resolveExit => { child.once('error', error => resolveExit(error.message)); child.once('close', (code, signal) => resolveExit(code === 0 ? null : String(signal ?? code))); });
  const { bytes, retainedBytes, truncatedBytes } = evidence.finish(); events.push({ label, elapsedMs: Math.round(performance.now() - started), failure, log, bytes, retainedBytes, truncatedBytes });
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ resources, events }, null, 2) + '\n');
  if (failure) throw new Error(label + ' failed; inspect ' + log);
}
try {
  await run('node', 'npm', ['test']);
  await run('architecture', 'npm', ['run', 'verify:architecture']);
  await run('csharp', 'npm', ['run', 'verify:csharp']);
  await run('rust', 'systemd-run', ['--user', '--scope', '--quiet',
    '--property=MemoryMax=' + String(BigInt(resources['memory.max']) < 16n * 1024n ** 3n ? BigInt(resources['memory.max']) : 16n * 1024n ** 3n),
    '--property=MemorySwapMax=0', '--property=TasksMax=' + String(BigInt(resources['pids.max']) < 2048n ? BigInt(resources['pids.max']) : 2048n),
    '--working-directory=' + repository, process.execPath, 'scripts/verify-rust.mjs'], userManagerEnvironment(process.env));
  await run('managed-distribution', process.execPath, ['scripts/publish-csharp.mjs', '--mode', 'managed', '--output', managed]);
  await run('nativeaot-distribution', process.execPath, ['scripts/publish-csharp.mjs', '--mode', 'nativeaot', '--output', native]);
  await run('rust-distribution', process.execPath, ['scripts/publish-rust.mjs', '--output', rust]);
  await run('matrix', process.execPath, ['scripts/contract-matrix.mjs', '--managed', managed, '--nativeaot', native, '--rust', rust, '--output', matrix]);
  await run('contracts', process.execPath, ['scripts/verify-contracts.mjs', matrix]);
  await run('performance', process.execPath, ['scripts/verify-performance.mjs', matrix, join(output, 'performance')]);
  await run('containers', process.execPath, ['scripts/verify-container.mjs', matrix]);
  await run('migrations', process.execPath, ['services/crossfire/scripts/verify-migrations.mjs']);
  verified = true;
  console.log(JSON.stringify({ status: 'passed', targets: ['node', 'csharp-managed', 'csharp-nativeaot','rust'], resources, evidence: output }));
} finally {
  if (verified) { rmSync(temporary, { recursive: true, force: true }); fixtures.close(); }
  else console.error('Failed-gate artifacts retained for bounded diagnosis: ' + temporary + '; fixtures: ' + fixtures.directory + '; remove after their last diagnostic use.');
}
