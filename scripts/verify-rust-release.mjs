import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { repository } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';
import { testEvidence } from './test-evidence.mjs';
import { verificationFixtures } from './verification-fixtures.mjs';

const [requested] = process.argv.slice(2);
if (process.argv.length !== 3 || !isAbsolute(requested)) throw new Error('Supply one absolute new Rust verification evidence directory');
const output = resolve(requested);
if (existsSync(output) || !existsSync(dirname(output))) throw new Error('Use a new evidence directory with an existing parent');
const resources = verifyTestResources(), events = [], fixtures = verificationFixtures();
mkdirSync(output, { mode: 0o700 });
const temporary = mkdtempSync(join(output, 'distribution-')), distribution = join(temporary, 'rust');
let completed = false;
async function run(label, binary, arguments_) {
  const started = performance.now(), log = join(output, label + '.log'), evidence = testEvidence(log);
  const child = spawn(binary, arguments_, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { evidence.append('stdout', bytes); process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { evidence.append('stderr', bytes); process.stderr.write(bytes); });
  const failure = await new Promise(complete => { child.once('error', error => complete(error.message)); child.once('close', (code, signal) => complete(code === 0 ? null : String(signal ?? code))); });
  const counts = evidence.finish(); events.push({ label, elapsedMs: Math.round(performance.now() - started), failure, log, bytes: counts.bytes, retainedBytes: counts.retainedBytes, truncatedBytes: counts.truncatedBytes });
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ implementation: 'rust', resources, events }, null, 2) + '\n');
  if (failure) throw new Error(label + ' failed; inspect ' + log);
}
try {
  await run('architecture', 'npm', ['run', 'verify:architecture']);
  await run('typecheck', 'npm', ['run', 'typecheck']);
  await run('rust', process.execPath, ['scripts/verify-rust.mjs']);
  await run('distribution', process.execPath, ['scripts/publish-rust.mjs', '--output', distribution]);
  await run('installed-contracts', process.execPath, ['scripts/verify-rust-products.mjs', distribution]);
  await run('container-contracts', process.execPath, ['scripts/verify-rust-container.mjs', distribution]);
  await run('knex', process.execPath, ['services/crossfire/scripts/verify-migrations.mjs']);
  completed = true;
  console.log(JSON.stringify({ status: 'passed', implementation: 'rust', resources, evidence: output }));
} finally {
  if (completed) { rmSync(temporary, { recursive: true, force: true }); fixtures.close(); }
  else console.error('Unsuccessful scoped gate artifacts retained for diagnosis: ' + temporary + '; fixtures: ' + fixtures.directory);
}
