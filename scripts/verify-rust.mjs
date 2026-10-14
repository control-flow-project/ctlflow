import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal(process.argv.length, 2, 'Rust verification has no runtime-selection or skip flags');
const cgroup = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3);
assert(cgroup && !cgroup.split('/').includes('..'), 'A bounded unified process resource scope is required');
const memory = readFileSync(join('/sys/fs/cgroup', cgroup, 'memory.max'), 'utf8').trim();
const swap = readFileSync(join('/sys/fs/cgroup', cgroup, 'memory.swap.max'), 'utf8').trim();
const tasks = readFileSync(join('/sys/fs/cgroup', cgroup, 'pids.max'), 'utf8').trim();
assert(memory !== 'max' && BigInt(memory) > 0n && BigInt(memory) <= 16n * 1024n ** 3n, 'Run verification in a process scope bounded to at most 16 GiB');
assert.equal(swap, '0', 'Verification must not consume swap');
assert(tasks !== 'max' && Number(tasks) <= 2048, 'Verification must have a finite 2048-task aggregate bound');
const prepared = mkdtempSync(join(tmpdir(), 'crossfire-rust-knex-')); chmodSync(prepared, 0o700);
const template = join(prepared, 'management.sqlite');
process.on('exit', () => rmSync(prepared, {recursive:true, force:true}));
await migrateDatabase(template);
process.env.CROSSFIRE_TEST_DATABASE_TEMPLATE = template;

function execute(command, arguments_, {environment = process.env, line, timeout = 300_000, workingDirectory = root} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {cwd:workingDirectory, env:environment, stdio:['ignore','pipe','pipe']});
    let output = '', buffered = '', timedOut = false, parseError = null, escalation;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); escalation = setTimeout(() => child.kill('SIGKILL'), 2000); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const capture = chunk => {
      output = (output + chunk).slice(-262_144);
      if (output.charCodeAt(0) >= 0xdc00 && output.charCodeAt(0) <= 0xdfff) output = output.slice(1);
    };
    child.stderr.on('data', capture);
    child.stdout.on('data', chunk => {
      capture(chunk);
      if (!line || parseError) return;
      buffered += chunk;
      if (buffered.length > 2_097_152) { parseError = new Error('Compiler metadata exceeds its line resource bound'); child.kill('SIGTERM'); return; }
      while (buffered.includes('\n')) {
        const newline = buffered.indexOf('\n'), text = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        try { if (text.trim()) line(text); } catch (error) { parseError = error; child.kill('SIGTERM'); return; }
      }
    });
    child.once('error', error => { clearTimeout(timer); clearTimeout(escalation); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (parseError) return reject(parseError);
      if (code !== 0 || timedOut) return reject(new Error(`${command} failed (${timedOut ? 'timeout' : code ?? signal})\n${output}`));
      resolve(output);
    });
  });
}

await execute('node', ['--test','scripts/native-architecture.test.mjs']);
await execute('node', ['scripts/native-architecture.mjs']);
await execute('cargo', ['fmt','--all','--','--check']);
await execute('cargo', ['clippy','--workspace','--all-targets','--locked','--','-D','warnings']);
await execute('npm', ['run','build']);
const piBinary = JSON.parse(await execute('node', ['--input-type=module','-e', 'import {preparePi,piBinary} from "@ctlflow/crossfire-test-support/pi"; preparePi(); process.stdout.write(JSON.stringify(piBinary()));'], {timeout:360_000}));
assert(typeof piBinary === 'string' && piBinary.startsWith('/'), 'Verified native Pi asset must have an exact absolute executable path');
const nativeEnvironment = {...process.env, CROSSFIRE_TEST_PI_BINARY:piBinary};
await execute('node', ['services/crossfire/scripts/generate-rust-schema.mjs','--database',template,'--check']);
await execute('node', ['services/crossfire/scripts/generate-rust-catalog.mjs','--check']);
await execute('node', ['services/crossfire/scripts/generate-rust-operations.mjs','--check']);
await execute('node', ['services/crossfire/scripts/generate-rust-pi-extension.mjs']);
const examples = new Map();
await execute('cargo', ['build','--workspace','--examples','--locked','--message-format=json'], {line:text => {
  const event = JSON.parse(text);
  if (event.reason === 'compiler-artifact' && event.target.kind.includes('example') && event.executable) examples.set(event.target.name,event.executable);
}});
const executables = new Map();
await execute('cargo', ['test','--workspace','--all-targets','--locked','--no-run','--message-format=json'], {line:text => {
  const event = JSON.parse(text);
  if (event.reason === 'compiler-artifact' && event.profile?.test && event.executable) {
    executables.set(event.executable, {name:event.target.name, source:event.target.src_path});
  }
}});
assert(executables.size > 0, 'No compiled Rust test artifacts were found');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-rust-verification-')); chmodSync(directory, 0o700);
const pending = [...executables.entries()], results = [], failures = [];
try {
  const workers = Array.from({length:Math.min(availableParallelism(), pending.length)}, async () => {
    while (pending.length) {
      const selected = pending.shift(); if (!selected) return;
      const [binary, target] = selected;
      const privateDirectory = mkdtempSync(join(directory, 'test-')); chmodSync(privateDirectory, 0o700);
      const started = performance.now();
      try {
        const output = await execute(binary, ['--test-threads=1'], {environment:{...nativeEnvironment, TMPDIR:privateDirectory, TMP:privateDirectory, TEMP:privateDirectory}, timeout:120_000});
        const summary = /test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/u.exec(output);
        assert(summary && summary[2] === '0' && summary[3] === '0', 'Every compiled test must pass without ignored cases');
        results.push({...target, milliseconds:Math.round(performance.now() - started), passed:Number(summary[1])});
      } catch (error) { failures.push({source:target.source, message:error instanceof Error ? error.message : String(error)}); }
      finally { rmSync(privateDirectory, {recursive:true, force:true}); }
    }
  });
  await Promise.all(workers);
} finally { rmSync(directory, {recursive:true, force:true}); }
for (const result of results.sort((first, second) => first.source.localeCompare(second.source))) console.log(JSON.stringify(result));
for (const failure of failures) console.error(JSON.stringify(failure));
assert.equal(failures.length, 0, 'Rust verification failures remain');
assert(examples.has('interchange') && examples.has('activity_interchange'), 'Both native interchange proofs must be built');
assert(examples.has('calendar_interchange'), 'The native calendar parity proof must be built');
const calendar = await execute('node', ['services/crossfire/rust/tests/calendar-parity.mjs',examples.get('calendar_interchange')]);
console.log(calendar.trim());
const interchange = await execute('node', ['services/crossfire/rust/tests/sqlite-parity.mjs',examples.get('interchange'),examples.get('activity_interchange')]);
console.log(interchange.trim());
assert(examples.has('journal_interchange'), 'The native delivery journal interchange proof must be built');
const journal = await execute('node', ['services/crossfire/rust/tests/journal-parity.mjs',examples.get('journal_interchange')]);
console.log(journal.trim());
assert(examples.has('matrix_acceptance'), 'Actual native Matrix authority acceptance must be built');
const service = join(root, 'services/crossfire');
await execute('node', [join(service, 'dist/scripts/architecture-proof/conduit-assets.js')], {workingDirectory:service});
const nativeMatrix = await execute('node', [join(service, 'rust/tests/matrix-parity.mjs'),examples.get('matrix_acceptance')], {workingDirectory:service, timeout:120_000});
console.log(nativeMatrix.trim());
assert(examples.has('enrollment_acceptance'), 'Actual native enrollment lifecycle acceptance must be built');
const enrollment = await execute('node', [join(service, 'rust/tests/enrollment-parity.mjs'),examples.get('enrollment_acceptance')], {workingDirectory:service,timeout:150000});
console.log(enrollment.trim());
console.log(JSON.stringify({status:'passed', binaries:results.length, tests:results.reduce((total,result) => total + result.passed, 0), availableCores:availableParallelism(), scope:'implemented Rust sources; not full-product certification'}));
