import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEvidence } from './test-evidence.mjs';
import { resourceLimits, verifyTestResources } from './test-resources.mjs';
import { selectedTest } from './test.mjs';

test('browser selection includes every owning browser module, excluding them from non-browser runs', () => {
  for (const file of ['browser.test.js', 'fleet-browser.test.js', 'reports-browser.test.js', 'management-fleet-browser.test.js',
    'cookie-browser.test.js', 'nested/management-agents-browser.test.js']) {
    assert.equal(selectedTest('tests', file, 'browser'), true, file);
    assert.equal(selectedTest('tests', file, 'non-browser'), false, file);
    assert.equal(selectedTest('tests', file, 'all'), true, file);
  }
  assert.equal(selectedTest('tests', 'receipts.test.js', 'browser'), false);
  assert.equal(selectedTest('tests', 'receipts.test.js', 'non-browser'), true);
  assert.equal(selectedTest('tests', 'fleet.integration.js', 'integration'), true);
  assert.equal(selectedTest('tests', 'helper.js', 'all'), false);
});

test('streamed evidence keeps finite logs and diagnostics while counting every summary beyond the byte limit', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'test-evidence-')); scope.after(() => rmSync(directory, { recursive: true }));
  const file = join(directory, 'file.log'), evidence = testEvidence(file, { logBytes: 1024, tailBytes: 128, lineBytes: 256 });
  const chunk = Buffer.from('x'.repeat(4096));
  for (let index = 0; index < 1024; index++) evidence.append('stdout', chunk);
  const summary = Buffer.from('\nℹ tests 42\nℹ fail 3\nℹ cancelled 2\n');
  for (const byte of summary) evidence.append('stdout', Buffer.from([byte]));
  evidence.append('stderr', 'Failure tail.');
  const result = evidence.finish();
  assert.equal(result.complete, true); assert.equal(result.tests, 42); assert.equal(result.failed, 3); assert.equal(result.cancelled, 2);
  assert.equal(result.retainedBytes, 1024); assert.equal(result.bytes, chunk.length * 1024 + summary.length + 13);
  assert.equal(result.truncatedBytes, result.bytes - result.retainedBytes);
  assert(Buffer.byteLength(result.tail) <= 128); assert.match(result.tail, /Failure tail\./u);
  const log = readFileSync(file, 'utf8'); assert(log.length < 1300); assert.match(log, /Evidence byte limit reached/u);
  assert.throws(() => evidence.append('stdout', 'closed'), /already closed/u);
});

test('evidence distinguishes missing, duplicate and overflowed counters without discarding genuine failures', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'test-counters-')); scope.after(() => rmSync(directory, { recursive: true }));
  for (const [index, text] of ['ℹ tests 1\nℹ fail 0\n', 'ℹ tests 1\nℹ tests 2\nℹ fail 0\nℹ cancelled 0\n',
    'ℹ tests 9999999999999999999\nℹ fail 0\nℹ cancelled 0\n'].entries()) {
    const evidence = testEvidence(join(directory, String(index))); evidence.append('stdout', text); assert.equal(evidence.finish().complete, false);
  }
  const evidence = testEvidence(join(directory, 'valid'));
  evidence.append('stdout', 'ℹ tests 0\r\nℹ fail 0\r\nℹ cancelled 0'); assert.equal(evidence.finish().complete, true);
});

test('process-group resource verification uses effective finite ancestor limits and fails closed on absent, unsafe or unbounded scopes', () => {
  const root = '/resource-test', group = '/resource-test/user/scope';
  const files = new Map([[group + '/memory.max', 'max'], [group + '/memory.swap.max', 'max'], [group + '/pids.max', 'max'],
    [root + '/user/memory.max', '4294967296'], [root + '/user/memory.swap.max', '0'], [root + '/user/pids.max', '512']]);
  const read = file => { if (files.has(file)) return files.get(file); throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); };
  assert.deepEqual(resourceLimits(group, root, read), { 'memory.max': '4294967296', 'memory.swap.max': '0', 'pids.max': '512' });
  files.set(root + '/user/memory.max', '25769803776'); files.set(root + '/user/pids.max', '4096');
  assert.deepEqual(resourceLimits(group, root, read), { 'memory.max': '25769803776', 'memory.swap.max': '0', 'pids.max': '4096' });
  for (const [key, value] of [['memory.max', 'max'], ['memory.swap.max', 'max'], ['pids.max', '0'], ['pids.max', 'invalid']]) {
    const path = root + '/user/' + key, original = files.get(path); files.set(path, value);
    assert.throws(() => resourceLimits(group, root, read), /resource limit|finite/u); files.set(path, original);
  }
  assert.throws(() => resourceLimits('/outside', root, read), /outside/u);
  const actual = verifyTestResources();
  assert(BigInt(actual['memory.max']) > 0n); assert(BigInt(actual['memory.swap.max']) >= 0n); assert(BigInt(actual['pids.max']) > 0n);
});
