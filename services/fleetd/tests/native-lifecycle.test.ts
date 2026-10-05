import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { success, failure, type Result } from '@crossfire/kernel/result';
import type { Clock } from '@crossfire/agent-core/port';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@crossfire/agent-core/owned-runtime';
import type { RuntimeObservationEvent } from '@crossfire/agent-core/runtime';
import { createNativeLifecycle, type NativeLifecycleServices } from '@fleetd/domain/native-lifecycle';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!predicate()) { assert(performance.now() < deadline, 'Native lifecycle observation deadline'); await yieldLoop(); }
}
function fixture() {
  let now = 1000, timerId = 0, busy = false, unknown = false, pending = false, decisions = false;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = { now: () => now, deadline: () => new AbortController().signal,
    schedule(callback, milliseconds) { const id = ++timerId; timers.set(id, { at: now + milliseconds, callback }); return () => { timers.delete(id); }; },
    delay: async (_milliseconds, signal) => { signal.throwIfAborted(); },
  };
  const saved: SavedRuntimeContext[] = [{ context: 'shared', runtime: 'fixture', sessionId: 'exact-history', workspace: '/fixture' }];
  const started: AbortController[] = [], closed: string[] = [], delivered: string[] = [], failures: unknown[] = [], observed: RuntimeObservationEvent[] = [];
  let recovered = 0, inspect: (() => Promise<{ busy: boolean }>) | undefined;
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'fixture', initialSettings: [], initial: 'running',
    hooks: { requestDecision: async () => failure('forbidden', 'Unexpected decision'), pendingInput: () => pending,
      pendingDecisions: () => decisions, observe: event => observed.push(event) },
    saved: async () => success(saved), failed: (_session, error) => failures.push(error), recovered: () => { recovered++; },
    start: async (_signal, observe) => {
      const stop = new AbortController(); started.push(stop);
      const context = saved.find(context => context.context === 'shared')!;
      observe({ kind: 'state', observation: { runtime: 'fixture', sessionId: context.sessionId, roomId: null, state: 'idle', observedAt: now, settings: [], errorMessage: null } });
      const connection: OwnedRuntimeConnection = { sessionId: context.sessionId, signal: stop.signal, approval: 'none',
        attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} },
        attachments: async () => saved.map(context => ({ context: context.context, attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} } })),
        inspect: () => inspect ? inspect() : unknown ? Promise.reject(new Error('Unknown native status')) : Promise.resolve({ busy }),
        deliver: async (_text, messageId) => { delivered.push(messageId); }, recover: async (_text, messageId) => delivered.includes(messageId),
        acknowledge: () => {}, settle: async () => false, turnControl: { activeTurn: async () => null, interrupt: async () => {} },
        close: async () => { closed.push(context.sessionId); stop.abort(new Error('Closed native fixture')); },
      };
      return success(connection);
    },
  };
  async function advance(milliseconds: number) {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await yieldLoop();
  }
  return { services, advance, started, saved, closed, delivered, failures, observed,
    setBusy: (value: boolean) => { busy = value; }, setUnknown: (value: boolean) => { unknown = value; },
    setPending: (value: boolean) => { pending = value; }, setDecisions: (value: boolean) => { decisions = value; },
    setInspect: (value: typeof inspect) => { inspect = value; }, recovered: () => recovered, timers: () => timers.size };
}

test('30 minute sleep closes native processes, not the listener; input resumes the exact saved history', async scope => {
  const fixture_ = fixture(), stop = new AbortController();
  const managed = value(await createNativeLifecycle(fixture_.services, stop.signal));
  scope.after(() => managed.close());
  assert.equal(managed.nativeState().phase, 'running');
  await fixture_.advance(1799999); assert.equal(fixture_.closed.length, 0);
  await fixture_.advance(1); await until(() => managed.nativeState().phase === 'sleeping');
  assert.equal(fixture_.closed.length, 1); assert.equal(managed.runtime.signal.aborted, false);
  assert.equal((await managed.attachment()).ok, false);
  assert.deepEqual(value(await managed.contexts()), [{ context: 'shared', runtime: 'fixture', sessionId: 'exact-history' }]);
  assert.equal(fixture_.started.length, 1, 'Read-only metadata must not start a native process');
  await managed.runtime.deliver('Wake', 'message-1'); managed.runtime.acknowledge(['message-1']);
  assert.equal(fixture_.started.length, 2); assert.equal(managed.runtime.sessionId, 'exact-history');
  assert.equal(value(await managed.attachment()).sessionId, 'exact-history');
  assert.equal(managed.nativeState().phase, 'running');
});

test('recovery binds sleeping histories without a process and concurrent inputs share one native generation', async scope => {
  const fixture_ = fixture(); fixture_.services.initial = 'sleeping';
  const managed = value(await createNativeLifecycle(fixture_.services, new AbortController().signal));
  scope.after(() => managed.close());
  assert.equal(fixture_.started.length, 0); assert.equal(managed.nativeState().historyAvailable, true);
  await Promise.all([managed.runtime.deliver('One', 'one'), managed.runtime.deliver('Two', 'two')]);
  managed.runtime.acknowledge(['one', 'two']);
  assert.equal(fixture_.started.length, 1); assert.deepEqual(fixture_.delivered.toSorted(), ['one', 'two']);
});

test('all native activity, unresolved decisions, pending listener work and unknown inspection veto sleep', async scope => {
  for (const condition of ['busy', 'decisions', 'pending', 'unknown'] as const) {
    const fixture_ = fixture();
    const managed = value(await createNativeLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    fixture_.setBusy(condition === 'busy'); fixture_.setDecisions(condition === 'decisions'); fixture_.setPending(condition === 'pending'); fixture_.setUnknown(condition === 'unknown');
    await fixture_.advance(1800000);
    assert.equal(fixture_.closed.length, 0, condition); assert.equal(managed.nativeState().phase, 'running', condition);
    fixture_.setBusy(false); fixture_.setDecisions(false); fixture_.setPending(false); fixture_.setUnknown(false);
    await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
  }
});

test('unacknowledged publication vetoes sleep; canceled unreceived input does not leave a false permanent busy flag', async scope => {
  const fixture_ = fixture();
  const managed = value(await createNativeLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  await managed.runtime.deliver('One', 'one'); await fixture_.advance(1800000);
  assert.equal(fixture_.closed.length, 0); managed.runtime.acknowledge(['one']);
  assert.equal(await managed.runtime.recover('Not received', 'unreceived'), false);
  await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
});

test('native crash is reported and recovered without disconnecting the listener or changing history', async scope => {
  const fixture_ = fixture();
  const managed = value(await createNativeLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  fixture_.started[0]!.abort(new Error('Native crash'));
  await until(() => fixture_.started.length === 2 && managed.nativeState().phase === 'running');
  assert.equal(managed.runtime.signal.aborted, false); assert.equal(managed.runtime.sessionId, 'exact-history');
  assert.equal(fixture_.failures.length, 1); assert.equal(fixture_.recovered(), 2);
});

test('idle inspection cannot close a generation after new input arrives; zero disables idle sleep', async scope => {
  const fixture_ = fixture();
  const managed = value(await createNativeLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  let release!: (value: { busy: boolean }) => void;
  fixture_.setInspect(() => new Promise(resolve => { release = resolve; }));
  await fixture_.advance(1800000); assert.equal(typeof release, 'function');
  await managed.runtime.deliver('Raced input', 'race'); managed.runtime.acknowledge(['race']);
  release({ busy: false }); await yieldLoop(); assert.equal(fixture_.closed.length, 0);
  managed.runtime.lifecycle!.configureIdle(0); fixture_.setInspect(undefined);
  await fixture_.advance(180000000); assert.equal(fixture_.closed.length, 0); assert.equal(fixture_.timers(), 0);
});

test('missing history and a resume with a different identity fail closed without implicit fresh context', async () => {
  const fixture_ = fixture(); fixture_.services.initial = 'sleeping'; fixture_.saved.length = 0;
  const missing = await createNativeLifecycle(fixture_.services, new AbortController().signal);
  assert.equal(missing.ok, false); assert.equal(fixture_.started.length, 0);
  const changed = fixture();
  const start = changed.services.start;
  changed.services.start = async (...input) => { const result = await start(...input); return result.ok ? success({ ...result.value, sessionId: 'different-history' }) : result; };
  const result = await createNativeLifecycle(changed.services, new AbortController().signal);
  assert.equal(result.ok, false); assert.equal(result.ok ? null : result.error.code, 'conflict'); assert.equal(changed.closed.length, 1);
});
