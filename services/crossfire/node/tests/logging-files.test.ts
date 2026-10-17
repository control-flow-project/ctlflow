import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, symlinkSync, linkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createDiagnosticLog } from '@ctlflow/crossfire-adapter-filesystem/logging';
import { createLoggingMaintenance } from '@ctlflow/crossfire-agent-core/logging-maintenance';
import { DAY_MS, LOGGING_MAINTENANCE_MS } from '@ctlflow/crossfire-kernel/logging';
import { success, failure } from '@ctlflow/crossfire-kernel/result';
import { withClock } from '../scripts/test-support/clock.js';

type LogRecord = { at: number; message: string };
function records(directory: string): LogRecord[] {
  return readdirSync(directory).filter(name => name.endsWith('.jsonl')).flatMap(name => readFileSync(join(directory, name), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line) as LogRecord));
}

test('long-lived diagnostic writers roll by UTC day and expire exact timestamps within the boundary partition', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-logging-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  let now = Date.UTC(2026, 9, 1, 12);
  const log = createDiagnosticLog(directory, 7, () => now); cleanup(scope, () => log.close());
  log.write('expired'); now += 1000; log.write('cutoff equality'); now += 1000; log.write('retained');
  const bytes = readFileSync(join(directory, '2026-10-01.jsonl'));
  now = Date.UTC(2026, 9, 8, 12, 0, 1);
  assert.equal((await log.prune()).ok, true);
  assert.deepEqual(records(directory).map(record => record.message), ['cutoff equality', 'retained']);
  log.write('new day'); assert(readdirSync(directory).includes('2026-10-08.jsonl'));
  assert.equal(statSync(join(directory, '2026-10-08.jsonl')).mode & 0o777, 0o600);
  assert(!readFileSync(join(directory, '2026-10-01.jsonl')).equals(bytes));
  now += 8 * DAY_MS; assert.equal((await log.prune()).ok, true);
  assert.deepEqual(records(directory), []); log.write('still alive');
  assert.deepEqual(records(directory).map(record => record.message), ['still alive']);
  assert.equal(log.error(), null);
});

test('diagnostic entries preserve multibyte output with bounded records and never follow links or erase unrelated state', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-log-safety-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const now = Date.UTC(2026, 9, 13, 12), log = createDiagnosticLog(directory, 7, () => now);
  cleanup(scope, () => log.close());
  const text = 'ξ😀'.repeat(30000); log.write(text);
  assert.equal(records(directory).map(record => record.message).join(''), text);
  assert(records(directory).length > 1);
  const nativeHistory = join(directory, 'native-history.json'); writeFileSync(nativeHistory, 'must remain', { mode: 0o600 });
  symlinkSync(nativeHistory, join(directory, '2026-10-01.jsonl'));
  assert.equal((await log.prune()).ok, false);
  assert.equal(readFileSync(nativeHistory, 'utf8'), 'must remain');
  assert(log.error()?.includes('cleanup'));
  rmSync(join(directory, '2026-10-01.jsonl'));
  const other = join(directory, '2026-10-02.jsonl'); linkSync(nativeHistory, other);
  assert.equal((await log.prune()).ok, false); assert.equal(readFileSync(nativeHistory, 'utf8'), 'must remain');
  chmodSync(join(directory, '2026-10-13.jsonl'), 0o644); log.write('must not append');
  assert(log.error()?.includes('logging'));
});

test('malformed boundary records remain for inspection and do not get replaced by a truncated file', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-log-boundary-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const file = join(directory, '2026-10-01.jsonl'), original = '{"at":1,"message":"unfinished"';
  writeFileSync(file, original, { mode: 0o600 });
  const log = createDiagnosticLog(directory, 7, () => Date.UTC(2026, 9, 8, 12)); cleanup(scope, () => log.close());
  assert.equal((await log.prune()).ok, false);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(readdirSync(directory).some(name => name.includes('.pending-')), false);
});

test('unrelated files stay untouched and an unsafe partition cannot prevent independent expired diagnostics from being removed', async scope => {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-log-invalid-')); cleanup(scope, () => rmSync(root, { recursive: true }));
  const directory = join(root, 'logs'), source = join(root, 'unrelated.bin'), now = Date.UTC(2026, 9, 13, 12), malformed = Buffer.from([0xff, 0x0a]);
  writeFileSync(source, malformed, { mode: 0o600 });
  const log = createDiagnosticLog(directory, 7, () => now); cleanup(scope, () => log.close());
  symlinkSync(source, join(directory, '2026-10-01.jsonl'));
  const expired = join(directory, '2026-10-02.jsonl'); writeFileSync(expired, '{"at":1,"message":"old"}\n', { mode: 0o600 });
  assert.equal((await log.prune()).ok, false); assert.equal(readdirSync(directory).includes('2026-10-02.jsonl'), false);
  assert.deepEqual(readFileSync(source), malformed); log.write('writer remains available');
  assert.deepEqual(JSON.parse(readFileSync(join(directory, '2026-10-13.jsonl'), 'utf8').trim()) as unknown,
    { at: now, message: 'writer remains available' });
});

test('logging maintenance runs without messages, retries bounded backlogs and stops owned timers', withClock(async (scope, clock) => {
  const cuts: number[] = []; let remaining = 2, unavailable = false;
  const task = createLoggingMaintenance(clock, async () => {
    cuts.push(clock.now());
    if (unavailable) return failure('unavailable', 'Controlled storage failure');
    return success({ more: remaining-- > 0 });
  }, LOGGING_MAINTENANCE_MS, () => {});
  cleanup(scope, () => task.close());
  await task.drain(); assert.deepEqual(cuts, [0]);
  await clock.advance(5000); assert.deepEqual(cuts, [0, 5000]);
  await clock.advance(5000); assert.deepEqual(cuts, [0, 5000, 10000]);
  await clock.advance(LOGGING_MAINTENANCE_MS); assert.equal(cuts.length, 4);
  unavailable = true; await task.drain(); assert.equal(task.error(), 'Controlled storage failure');
  unavailable = false; await clock.advance(5000); assert.equal(task.error(), null);
  const completed = cuts.length; await task.close(); await clock.advance(2 * LOGGING_MAINTENANCE_MS); assert.equal(cuts.length, completed);
}));
