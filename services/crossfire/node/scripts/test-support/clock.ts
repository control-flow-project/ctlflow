import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { setTimeout as poll } from 'node:timers/promises';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';

export function testClock(scope: TestContext) {
  const epoch = Date.now();
  let elapsed = 0, sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void; interval: number | undefined }>();
  const subscribers = new Set<(milliseconds: number) => Promise<void>>();
  const schedule: Clock['schedule'] = (callback, milliseconds, recurring = false) => {
    assert(Number.isSafeInteger(milliseconds) && milliseconds >= 0 && (!recurring || milliseconds > 0));
    const id = ++sequence;
    timers.set(id, { at: elapsed + milliseconds, callback, interval: recurring ? milliseconds : undefined });
    return () => { timers.delete(id); };
  };
  const clock: Clock = {
    now: () => elapsed, schedule,
    deadline: milliseconds => {
      const deadline = new AbortController();
      schedule(() => deadline.abort(new DOMException('Controlled deadline expired', 'TimeoutError')), milliseconds);
      return deadline.signal;
    },
    delay: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const finish = () => { cancel(); signal.removeEventListener('abort', aborted); resolve(); };
      const aborted = () => { cancel(); signal.removeEventListener('abort', aborted); reject(signal.reason); };
      const cancel = schedule(finish, milliseconds);
      signal.addEventListener('abort', aborted, { once: true });
    }),
  };
  async function advance(milliseconds: number) {
    assert(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
    for (let remaining = milliseconds; remaining > 0;) {
      const step = timers.size ? 1 : remaining;
      elapsed += step; remaining -= step;
      for (const [id, timer] of [...timers]) if (timer.at <= elapsed && timers.has(id)) {
        if (timer.interval === undefined) timers.delete(id); else timer.at += timer.interval;
        timer.callback();
      }
      await Promise.all([...subscribers].map(subscriber => subscriber(step)));
      await yieldLoop();
    }
  }
  async function until(predicate: () => boolean, message = 'Condition did not become true', timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) { assert(performance.now() < deadline, message); await advance(1); await poll(1); }
  }
  async function observe(predicate: () => boolean, message = 'I/O condition did not become true', timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) { assert(performance.now() < deadline, message); await poll(1); }
  }
  async function complete<Value>(promise: Promise<Value>): Promise<Value> {
    let settled = false;
    const observed = promise.finally(() => { settled = true; }); void observed.catch(() => {});
    await until(() => settled, 'Controlled operation did not settle'); return observed;
  }
  const close = () => { timers.clear(); subscribers.clear(); };
  cleanup(scope, close);
  return { ...clock, advance, until, observe, complete, wallNow: () => epoch + elapsed,
    close,
    subscribe: (subscriber: (milliseconds: number) => Promise<void>) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); } };
}

export function withClock(operation: (scope: TestContext, clock: ReturnType<typeof testClock>) => Promise<void>) {
  return async (scope: TestContext) => {
    const clock = testClock(scope);
    await operation(scope, clock);
  };
}
