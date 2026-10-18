import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runContractTargets } from './contract-runner.mjs';

function fixture(scope, names = ['node', 'csharp-managed', 'csharp-nativeaot', 'rust']) {
  const directory = mkdtempSync(join(tmpdir(), 'contract-runner-')); scope.after(() => rmSync(directory, { recursive: true }));
  const command = { binary: process.execPath, arguments: [] }, manifest = join(directory, 'matrix.json');
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, targets: names.map(name => ({ name, implementation: name.startsWith('csharp-') ? 'csharp' : name, server: command, daemon: command, cli: command })) }));
  const worker = join(directory, 'worker.mjs');
  return { directory, manifest, worker, bank: 'contract-runs', testTimeoutMs: 20000, deadlineMs: 30000 };
}

test('the shared matrix runner executes every target in its own bounded process and retains complete assertions', async scope => {
  const setup = fixture(scope);
  writeFileSync(setup.worker, `import test from 'node:test'; import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
test('isolated target',()=>{assert(process.env.CROSSFIRE_CONTRACT_TARGET);writeFileSync(join(process.env.CROSSFIRE_RUNNER_PROBE,process.env.CROSSFIRE_CONTRACT_TARGET+'.json'),JSON.stringify({pid:process.pid,target:process.env.CROSSFIRE_CONTRACT_TARGET}));});`);
  const result = await runContractTargets({ ...setup, environment: { CROSSFIRE_RUNNER_PROBE: setup.directory, CROSSFIRE_CONTRACT_TARGET: 'must-not-override-selection' } });
  scope.after(() => rmSync(result.evidence, { recursive: true }));
  const summary = JSON.parse(readFileSync(join(result.evidence, 'summary.json'), 'utf8'));
  assert.equal(summary.results.length, 4); assert(summary.results.every(value => value.complete && value.tests === 1 && !value.failed && !value.cancelled && !value.skipped && !value.todo && !value.failure));
  const probes = result.targets.map(name => JSON.parse(readFileSync(join(setup.directory, name + '.json'), 'utf8')));
  assert.equal(new Set(probes.map(value => value.pid)).size, 4); assert.deepEqual(probes.map(value => value.target), result.targets);
  assert(BigInt(summary.resources['memory.max']) > 0n); assert(BigInt(summary.resources['pids.max']) > 0n);
});

test('the shared matrix runner preserves a worker assertion failure instead of reporting a green bank', async scope => {
  const diagnostics = []; scope.mock.method(console, 'error', value => diagnostics.push(value));
  const setup = fixture(scope, ['node']);
  writeFileSync(setup.worker, "import test from 'node:test'; import assert from 'node:assert/strict'; test('required failure',()=>assert.fail('retained worker failure'));\n");
  await assert.rejects(runContractTargets(setup), error => {
    const evidence = /inspect (.+)$/u.exec(error.message)?.[1]; assert(evidence); scope.after(() => rmSync(evidence, { recursive: true }));
    const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8'));
    assert.equal(summary.results[0].failed, 1); assert(summary.results[0].failure); assert.match(readFileSync(summary.results[0].log, 'utf8'), /retained worker failure/u);
    return true;
  });
  assert.match(diagnostics.join('\n'), /retained worker failure/u);
});

test('the shared matrix runner rejects invalid worker paths, banks and deadlines before creating workers', async scope => {
  const setup = fixture(scope, ['node']);
  for (const change of [{ worker: 'relative' }, { bank: '../escape' }, { testTimeoutMs: 0 }, { deadlineMs: 20000 }, { cleanupMs: Infinity }])
    await assert.rejects(runContractTargets({ ...setup, ...change }), /absolute worker|finite ordered deadlines/u);
  assert.deepEqual(readdirSync(setup.directory), ['matrix.json']);
});

test('the shared matrix runner refuses skipped and unfinished scenarios even when the worker exits successfully', async scope => {
  scope.mock.method(console, 'error', () => {});
  for (const disposition of ['skip', 'todo']) {
    const setup = fixture(scope, ['node']);
    writeFileSync(setup.worker, "import test from 'node:test'; test('unexecuted required scenario',{ " + disposition + ": true },()=>{});\n");
    await assert.rejects(runContractTargets(setup), error => {
      const evidence = /inspect (.+)$/u.exec(error.message)?.[1]; assert(evidence); scope.after(() => rmSync(evidence, { recursive: true }));
      const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8'));
      assert.equal(summary.results[0][disposition === 'skip' ? 'skipped' : 'todo'], 1);
      assert.equal(summary.results[0].failure, 'Incomplete or failed shared contract assertions');
      return true;
    });
  }
});

test('the shared matrix runner refuses different assertion counts across selected implementations', async scope => {
  const setup = fixture(scope, ['node', 'rust']);
  writeFileSync(setup.worker, "import test from 'node:test'; test('shared scenario',()=>{}); if(process.env.CROSSFIRE_CONTRACT_TARGET==='node')test('not shared',()=>{});\n");
  await assert.rejects(runContractTargets(setup), error => {
    assert.match(error.message, /^Shared contract assertion counts differ/u);
    const evidence = /inspect (.+)$/u.exec(error.message)?.[1]; assert(evidence); scope.after(() => rmSync(evidence, { recursive: true }));
    const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8'));
    assert(summary.results.every(value => value.failure === null));
    assert.deepEqual(summary.results.map(value => value.tests).sort(), [1, 2]);
    return true;
  });
});

test('the shared matrix runner reaps a cancelled worker and cannot report it as passed', async scope => {
  scope.mock.method(console, 'error', () => {});
  const setup = fixture(scope, ['node']), cancellation = new AbortController(); cancellation.abort();
  writeFileSync(setup.worker, "import test from 'node:test'; test('would run',()=>{});\n");
  await assert.rejects(runContractTargets({ ...setup, signal: cancellation.signal }), error => {
    const evidence = /inspect (.+)$/u.exec(error.message)?.[1]; assert(evidence); scope.after(() => rmSync(evidence, { recursive: true }));
    const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8'));
    assert.equal(summary.results[0].failure, 'Contract verification cancelled');
    return true;
  });
});
