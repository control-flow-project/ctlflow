import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { createNativeStopReceipts, type NativeStopReceipt } from '../apps/daemon/src/native-stops.js';

function fixture(send: (receipt: NativeStopReceipt) => Promise<Result<void>> = async () => success(undefined)) {
  let release: (() => void) | undefined;
  const clock: Clock = { now: Date.now, deadline: () => new AbortController().signal, schedule: () => () => {},
    delay: async (_milliseconds, signal) => new Promise<void>(resolve => {
      const complete = () => { signal.removeEventListener('abort', complete); resolve(); };
      release = complete;
      if (signal.aborted) complete(); else signal.addEventListener('abort', complete, { once: true });
    }) };
  const stop = new AbortController(), agentId = randomUUID();
  let connected = true, binding = { fleetId: randomUUID(), connectionId: randomUUID(), credential: 'exact-controller' };
  const receipts = createNativeStopReceipts({ clock, signal: stop.signal, id: randomUUID, connected: () => connected, send });
  const activity = () => receipts.activity(agentId, randomUUID(), binding, () => binding);
  return { receipts, activity, agentId, binding, disconnected: () => { connected = false; }, reconnect: () => { connected = true; },
    turnover: () => { binding = { ...binding, connectionId: randomUUID() }; }, async advance() {
      const deadline = performance.now() + 5000;
      while (!release) { assert(performance.now() < deadline, 'Receipt worker reached its controlled delay'); await yieldLoop(); }
      const complete = release; release = undefined; complete();
    }, close: () => receipts.close() };
}

test('native proof exists only after close; receipt retries reuse exact run, credential and identity and never invoke native lifecycle', async scope => {
  const reports: NativeStopReceipt[] = []; let available = false;
  const current = fixture(async receipt => { reports.push(receipt); return available ? success(undefined) : failure('unavailable', 'Stop acknowledgment transport failed'); });
  cleanup(scope, current.close);
  const activity = current.activity();
  assert.equal((await current.receipts.confirm(current.agentId)).ok, false); assert.equal(reports.length, 0);
  current.receipts.closed(activity); assert(current.receipts.error());
  assert.equal((await current.receipts.confirm(current.agentId)).ok, false); assert.equal(current.receipts.error(), 'Stop acknowledgment transport failed');
  available = true; assert((await current.receipts.confirm(current.agentId)).ok);
  assert.deepEqual(reports[0], reports[1]); assert.equal(reports[0]!.runId, activity.runId); assert.deepEqual(reports[0]!.binding, current.binding);
  assert.equal(current.receipts.error(), null); current.receipts.closed(activity);
  assert((await current.receipts.confirm(current.agentId)).ok); assert.equal(reports.length, 2);
});

test('bounded controller worker retries pending receipts on its controlled clock', async scope => {
  let count = 0;
  const current = fixture(async () => ++count === 1 ? failure('unavailable', 'One outage') : success(undefined)); cleanup(scope, current.close);
  current.receipts.closed(current.activity()); await current.advance();
  const deadline = performance.now() + 5000;
  while (count !== 1) { assert(performance.now() < deadline); await yieldLoop(); }
  await current.advance();
  while (current.receipts.error() !== null) { assert(performance.now() < deadline); await yieldLoop(); }
  assert.equal(count, 2);
});

test('disconnected and superseded controller generations cannot publish native stop evidence', async scope => {
  const reports: NativeStopReceipt[] = [], current = fixture(async receipt => { reports.push(receipt); return success(undefined); }); cleanup(scope, current.close);
  current.receipts.closed(current.activity()); current.disconnected();
  assert.equal((await current.receipts.confirm(current.agentId)).ok, false); assert.equal(reports.length, 0);
  current.reconnect(); current.turnover();
  const stale = await current.receipts.confirm(current.agentId); assert(!stale.ok); assert.equal(stale.error.code, 'conflict'); assert.equal(reports.length, 0);
  const activity = current.activity(); current.receipts.closed(activity);
  assert((await current.receipts.confirm(current.agentId)).ok); assert.equal(reports.length, 1);
});

test('expired stop proofs remain fenced for retirement but cannot poison a healthy current connection or retry forever', async scope => {
  let reports = 0;
  const current = fixture(async () => { reports++; return success(undefined); }); cleanup(scope, current.close);
  current.receipts.closed(current.activity()); current.turnover();
  const stale = await current.receipts.confirm(current.agentId);
  assert(!stale.ok); assert.equal(stale.error.code, 'conflict');
  assert.equal(current.receipts.error(), null, 'Historical proofs are not current connection failures');
  await current.advance(); await current.advance();
  assert.equal(reports, 0, 'Only the original authenticated generation can submit its stop proof');
  assert.equal(current.receipts.error(), null);
});

test('new authenticated native activity invalidates in-flight stop evidence and keeps retirement fenced', async scope => {
  let delivered!: () => void;
  const current = fixture(async () => new Promise<Result<void>>(resolve => { delivered = () => resolve(success(undefined)); })); cleanup(scope, current.close);
  const old = current.activity(); current.receipts.closed(old);
  const pending = current.receipts.confirm(current.agentId); const activity = current.activity(); delivered();
  assert.equal((await pending).ok, false); assert.equal((await current.receipts.confirm(current.agentId)).ok, false);
  current.receipts.closed(old); assert.equal((await current.receipts.confirm(current.agentId)).ok, false);
  current.receipts.closed(activity); const confirmed = current.receipts.confirm(current.agentId); delivered(); assert((await confirmed).ok);
});

test('retired members release their bounded receipt slot; no receipt-only state grows beyond the roster bound', async scope => {
  const current = fixture(); cleanup(scope, current.close);
  for (let count = 0; count < 100; count++) current.receipts.activity(String(count), randomUUID(), current.binding, () => current.binding);
  assert.throws(() => current.activity(), /roster bound/u);
  current.receipts.forget('0'); current.activity();
});
