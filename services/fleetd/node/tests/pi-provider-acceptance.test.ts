import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, chmodSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import { inspectPiProvider, verifyPiProvider } from '../tools/pi-provider-acceptance.js';

test('Pi provider proof requires explicit model-work consent before inspecting credentials or creating files', async () => {
  const result = await inspectPiProvider(['--binary', '/missing/pi', '--provider', 'fixture', '--model', 'fixture-model', '--thinking-level', 'medium', '--evidence', '/missing/evidence'], new AbortController().signal);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'forbidden');
});

test('Pi provider proof rejects unsafe evidence and cancelled execution without changing the host', async scope => {
  const root = mkdtempSync(join(process.cwd(), '.temp/pi-provider-boundary-'));
  cleanup(scope, () => rmSync(root, { recursive: true, force: true }));
  const plan = { binary: piBinary(), provider: 'fixture', model: 'fixture-model', thinkingLevel: 'medium', evidence: root };
  chmodSync(root, 0o755); const publicResult = await verifyPiProvider(plan, new AbortController().signal);
  assert.equal(publicResult.ok, false); assert.deepEqual(readdirSync(root), []);
  chmodSync(root, 0o700); const link = join(root, 'linked'); symlinkSync(root, link);
  const linked = await verifyPiProvider({ ...plan, evidence: link }, new AbortController().signal);
  assert.equal(linked.ok, false); assert.deepEqual(readdirSync(root), ['linked']);
  const stop = new AbortController(); stop.abort(); const stopped = await verifyPiProvider(plan, stop.signal);
  assert.equal(stopped.ok, false); assert.deepEqual(readdirSync(root), ['linked']);
});

test('Pi provider proof rejects unavailable models, cleans owned private state and emits no credential or response data', { timeout: 60000 }, async scope => {
  const provider = await piProvider(scope), root = mkdtempSync(join(process.cwd(), '.temp/pi-provider-admission-'));
  cleanup(scope, () => rmSync(root, { recursive: true, force: true }));
  const source = readFileSync(join(provider.home, 'auth.json'));
  const result = await verifyPiProvider({ binary: piBinary(), provider: 'fixture', model: 'unavailable-model', thinkingLevel: 'medium', evidence: root }, new AbortController().signal);
  assert.equal(result.ok, false); assert.equal(provider.requests.length, 0);
  assert.deepEqual(readFileSync(join(provider.home, 'auth.json')), source);
  const files = readdirSync(root); assert.equal(files.length, 1); assert(files[0]!.endsWith('.json'));
  const report = JSON.parse(readFileSync(join(root, files[0]!), 'utf8'));
  assert.equal(report.status, 'failed'); assert.equal(report.phase, 'startup'); assert.equal(report.privateStateRemoved, true);
  assert.equal(report.modelResponses, 0); assert.deepEqual(report.usage, []);
  assert.equal(Object.hasOwn(report, 'credentials'), false); assert.equal(Object.hasOwn(report, 'responses'), false);
});

test('Pi provider proof fails a nonmatching real native response without retaining owned processes or private state', { timeout: 60000 }, async scope => {
  const provider = await piProvider(scope), root = mkdtempSync(join(process.cwd(), '.temp/pi-provider-response-'));
  cleanup(scope, () => rmSync(root, { recursive: true, force: true }));
  const source = readFileSync(join(provider.home, 'auth.json'));
  const result = await verifyPiProvider({ binary: piBinary(), provider: 'fixture', model: 'fixture-model', thinkingLevel: 'medium', evidence: root }, new AbortController().signal);
  assert.equal(result.ok, false); assert.equal(provider.requests.length, 1);
  assert.deepEqual(readFileSync(join(provider.home, 'auth.json')), source);
  const files = readdirSync(root); assert.equal(files.length, 1); assert(files[0]!.endsWith('.json'));
  const reportFile = join(root, files[0]!); assert.equal(statSync(reportFile).mode & 0o077, 0);
  const bytes = readFileSync(reportFile, 'utf8'), report = JSON.parse(bytes);
  assert.equal(report.status, 'failed'); assert.equal(report.phase, 'response-and-native-write');
  assert.equal(report.privateStateRemoved, true); assert.equal(report.modelResponses, 1); assert.equal(report.nativeFailures, 0);
  assert.deepEqual(report.checks.map((check: { name: string }) => check.name), ['startup']);
  assert.equal(bytes.includes('Fixture complete.'), false); assert.equal(bytes.includes('MEMORY_'), false);
  assert.equal(Object.hasOwn(report, 'credentials'), false); assert.equal(Object.hasOwn(report, 'responses'), false);
});
