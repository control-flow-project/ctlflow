import { roomContext } from '@ctlflow/crossfire-kernel/history-context';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { success, failure, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';
import type { InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
async function initializedLifecycle(...input: Parameters<typeof createNativeLifecycle>): Promise<Awaited<ReturnType<typeof createNativeLifecycle>>> {
  const started = await createNativeLifecycle(...input);
  if (started.ok) { await started.value.activate(); value(await started.value.resume()); }
  return started;
}
async function lazyLifecycle(...input: Parameters<typeof createNativeLifecycle>) {
  const started = await createNativeLifecycle(...input);
  if (started.ok) await started.value.activate();
  return started;
}
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
  const started: AbortController[] = [], closed: string[] = [], delivered: string[] = [], acknowledged: string[] = [], failures: unknown[] = [], observed: RuntimeObservationEvent[] = [];
  const nativeObservers: NonNullable<NativeLifecycleServices['hooks']['observe']>[] = [];
  let recovered = 0, inspect: (() => Promise<{ busy: boolean }>) | undefined;
  let provider: OwnedRuntimeConnection['provider'] = async () => success('unknown');
  let settle: OwnedRuntimeConnection['settle'] = async () => false;
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'fixture', approval: 'none', initialSettings: [], allowNewHistory: false,
    hooks: { requestDecision: async () => failure('forbidden', 'Unexpected decision'), pendingInput: () => pending,
      pendingDecisions: () => decisions, observe: event => observed.push(event) },
    saved: async () => success(saved), failed: (_session, error) => failures.push(error), recovered: () => { recovered++; },
    start: async (_signal, observe) => {
      nativeObservers.push(observe);
      const stop = new AbortController(); started.push(stop);
      const context = saved.find(context => context.context === 'shared')!;
      observe({ kind: 'state', observation: { runtime: 'fixture', sessionId: context.sessionId, roomId: null, state: 'idle', observedAt: now, settings: [], errorMessage: null } });
      const connection: OwnedRuntimeConnection = { sessionId: context.sessionId, signal: stop.signal, approval: 'none',
        provider: signal => provider(signal),
        attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} },
        attachments: async () => saved.map(context => ({ context: context.context, attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} } })),
        inspect: () => inspect ? inspect() : unknown ? Promise.reject(new Error('Unknown native status')) : Promise.resolve({ busy }),
        activity: async () => { const status = await connection.inspect(); return { ...status, contexts: saved.map(item => ({ context: item.context, sessionId: item.sessionId, busy: status.busy })) }; },
        deliver: async (_text, messageId) => { delivered.push(messageId); }, recover: async (_text, messageId) => delivered.includes(messageId),
        acknowledge: ids => { acknowledged.push(...ids); }, settle: cancellation => settle(cancellation), turnControl: { activeTurn: async () => null, interrupt: async () => 'inactive' },
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
  return { services, advance, started, saved, closed, delivered, acknowledged, failures, observed, nativeObservers,
    setSettle: (value: OwnedRuntimeConnection['settle']) => { settle = value; },
    setProvider: (value: OwnedRuntimeConnection['provider']) => { provider = value; },
    setBusy: (value: boolean) => { busy = value; }, setUnknown: (value: boolean) => { unknown = value; },
    setPending: (value: boolean) => { pending = value; }, setDecisions: (value: boolean) => { decisions = value; },
    setInspect: (value: typeof inspect) => { inspect = value; }, recovered: () => recovered, timers: () => timers.size };
}

test('diagnostics observe busy and owner-decision states without invoking readiness', async scope => {
  const current = fixture(), managed = value(await initializedLifecycle(current.services, scope.signal));
  scope.after(() => managed.close());
  let probes = 0;
  current.setProvider(async () => { probes++; return success('present'); });
  const observer = current.nativeObservers.at(-1)!;
  observer({ kind: 'state', observation: { runtime: 'fixture', sessionId: 'exact-history', roomId: null, state: 'working', observedAt: 1000, settings: [], errorMessage: null } });
  current.setPending(true); current.setDecisions(true);
  const nativeState = managed.nativeState(), observed = current.observed.length;
  current.setInspect(async () => assert.fail('Diagnostic reads cannot invoke mutating readiness inspection'));
  const report = await managed.diagnostics(scope.signal);
  assert.equal(report.state, 'working'); assert.equal(report.provider, 'present'); assert.equal(report.providerObservedAt, 1000);
  assert.equal(report.pendingInput, true); assert.equal(report.pendingDecision, true); assert.equal(probes, 1);
  assert.deepEqual(managed.nativeState(), nativeState);
  assert.equal(current.observed.length, observed); assert.equal(current.delivered.length, 0); assert.equal(current.failures.length, 0);
  observer({ kind: 'state', observation: { runtime: 'fixture', sessionId: 'exact-history', roomId: null, state: 'waiting-answer', observedAt: 1001, settings: [], errorMessage: null } });
  assert.equal((await managed.diagnostics(scope.signal)).state, 'waiting-answer');
});

test('failed or cancelled diagnostic provider reads do not fail or restart the owned native generation', async scope => {
  const current = fixture(), managed = value(await initializedLifecycle(current.services, scope.signal));
  scope.after(() => managed.close());
  const state = managed.nativeState(), count = current.started.length;
  current.setProvider(async () => failure('unavailable', 'Private detail that must not be forwarded'));
  assert.equal((await managed.diagnostics(scope.signal)).provider, 'unknown');
  current.setProvider(async signal => { signal.throwIfAborted(); throw new Error('Private failure'); });
  assert.equal((await managed.diagnostics(scope.signal)).provider, 'unknown');
  assert.equal((await managed.diagnostics(AbortSignal.abort())).provider, 'unknown');
  assert.deepEqual(managed.nativeState(), state); assert.equal(current.started.length, count); assert.equal(current.failures.length, 0);
});

test('sleeping diagnostics never open a native process, touch history files or probe a provider', async scope => {
  const current = fixture(); current.services.allowNewHistory = false;
  const managed = value(await createNativeLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  current.setProvider(async () => assert.fail('Sleeping inspection must not probe an account'));
  const report = await managed.diagnostics(scope.signal);
  assert.equal(report.state, 'sleeping'); assert.equal(report.provider, 'unknown'); assert.equal(current.started.length, 0);
});

test('listener activation never starts saved native histories or submits model work', async scope => {
  const current = fixture(), managed = value(await createNativeLifecycle(current.services, scope.signal));
  scope.after(() => managed.close());
  managed.runtime.lifecycle!.configureIdle(1800);
  assert.equal(managed.nativeState().phase, 'sleeping'); assert.equal(current.recovered(), 0);
  await managed.activate(); await managed.activate();
  assert.equal(managed.nativeState().phase, 'sleeping'); assert.equal(current.started.length, 0);
  assert.deepEqual(current.delivered, []);
});

test('sleeping mention capture uses immediate admission and retained history without a dummy model input', async scope => {
  const current = fixture(), stop = new AbortController(), deadline = new AbortController();
  const admission: InputAdmission = { priority: 'steering', signal: deadline.signal };
  let received: InputAdmission | undefined;
  const start = current.services.start;
  const managed = value(await lazyLifecycle({ ...current.services, allowNewHistory: false, start: async (signal, observe, requested) => {
    received = requested; return start(signal, observe, requested);
  } }, stop.signal));
  scope.after(() => managed.close());
  assert.equal(current.started.length, 0);
  assert.equal(await managed.runtime.turnControl!.activeTurn(undefined, admission), null);
  assert.equal(received, admission); assert.equal(current.started.length, 1); assert.deepEqual(current.delivered, []);
  await managed.runtime.deliver('Attributed steering', 'steering-1', deadline.signal, 'steering');
  managed.runtime.acknowledge(['steering-1']);
  deadline.abort(new Error('Input deadline no longer owns the native lifetime'));
  assert.equal(managed.runtime.sessionId, 'exact-history'); assert.equal(managed.runtime.signal.aborted, false);
  assert.equal(current.started[0]!.signal.aborted, false); assert.deepEqual(current.delivered, ['steering-1']);
});

test('a priority mention never waits behind an ordinary in-progress native resume or creates a competing engine', async scope => {
  const current = fixture(), stop = new AbortController();
  let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const start = current.services.start;
  const managed = value(await lazyLifecycle({ ...current.services, allowNewHistory: false, start: async (signal, observe, requested) => {
    entered = true; await gate; return start(signal, observe, requested);
  } }, stop.signal));
  scope.after(async () => { release(); await managed.close(); });
  const ordinary = managed.resume();
  await until(() => entered);
  await assert.rejects(managed.runtime.turnControl!.activeTurn(undefined, { priority: 'steering', signal: stop.signal }), /already in progress/u);
  assert.equal(current.started.length, 0);
  release(); assert((await ordinary).ok);
  assert.equal(await managed.runtime.turnControl!.activeTurn(undefined, { priority: 'steering', signal: stop.signal }), null);
  assert.equal(current.started.length, 1); assert.deepEqual(current.delivered, []);
});

test('immediate startup overload reports non-acceptance and a later mention resumes the same saved history', async scope => {
  const current = fixture(), stop = new AbortController();
  const start = current.services.start;
  let overloaded = true;
  const managed = value(await lazyLifecycle({ ...current.services, allowNewHistory: false, start: async (signal, observe, requested) =>
    overloaded ? failure('unavailable', 'Immediate native-start admission unavailable') : start(signal, observe, requested) }, stop.signal));
  scope.after(() => managed.close());
  await assert.rejects(managed.runtime.turnControl!.activeTurn(undefined, { priority: 'steering', signal: stop.signal }), /admission unavailable/u);
  assert.equal(current.failures.length, 1); assert.deepEqual(current.delivered, []); assert.equal(current.started.length, 0);
  overloaded = false;
  assert.equal(await managed.runtime.turnControl!.activeTurn(undefined, { priority: 'steering', signal: stop.signal }), null);
  assert.equal(current.started.length, 1); assert.equal(managed.runtime.sessionId, 'exact-history');
});

test('30 minute sleep closes native processes, not the listener; input resumes the exact saved history', async scope => {
  const fixture_ = fixture(), stop = new AbortController();
  const managed = value(await initializedLifecycle(fixture_.services, stop.signal));
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

test('retired native generations cannot overwrite current activity or mirror late output', async scope => {
  const fixture_ = fixture();
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
  const sleepingEvents = fixture_.observed.length;
  fixture_.nativeObservers[0]!({ kind: 'output', sessionId: 'exact-history', id: 'late-output', streamId: null, text: 'Old generation' });
  assert.equal(fixture_.observed.length, sleepingEvents);
  value(await managed.resume()); const liveEvents = fixture_.observed.length;
  fixture_.nativeObservers[0]!({ kind: 'state', observation: { sessionId: 'exact-history', roomId: null,
    runtime: 'fixture', state: 'failed', observedAt: 1801001, settings: [], errorMessage: 'Retired generation' } });
  assert.equal(fixture_.observed.length, liveEvents); assert.equal(managed.nativeState().phase, 'running');
  fixture_.nativeObservers[1]!({ kind: 'output', sessionId: 'exact-history', id: 'current-output', streamId: null, text: 'Current generation' });
  assert.equal(fixture_.observed.length, liveEvents + 1);
});

test('explicit resume wakes saved history for a terminal without model input and remains idempotent', async scope => {
  const fixture_ = fixture(); fixture_.services.allowNewHistory = false;
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  value(await managed.resume()); value(await managed.resume());
  assert.equal(fixture_.started.length, 1); assert.deepEqual(fixture_.delivered, []);
  assert.equal(value(await managed.attachment()).sessionId, 'exact-history');
  assert.equal(managed.nativeState().phase, 'running'); assert.equal(managed.runtime.signal.aborted, false);
});

test('recovery binds sleeping histories without a process and concurrent inputs share one native generation', async scope => {
  const fixture_ = fixture(); fixture_.services.allowNewHistory = false;
  const managed = value(await lazyLifecycle(fixture_.services, new AbortController().signal));
  scope.after(() => managed.close());
  assert.equal(fixture_.started.length, 0); assert.equal(managed.nativeState().historyAvailable, true);
  assert.equal(managed.runtime.approval, 'none');
  await Promise.all([managed.runtime.deliver('One', 'one'), managed.runtime.deliver('Two', 'two')]);
  managed.runtime.acknowledge(['one', 'two']);
  assert.equal(fixture_.started.length, 1); assert.deepEqual(fixture_.delivered.toSorted(), ['one', 'two']);
});

test('empty receipts and unanswered decisions do not wake sleeping history', async scope => {
  const current = fixture(); current.setDecisions(true);
  const managed = value(await lazyLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  assert.doesNotThrow(() => managed.runtime.acknowledge([]));
  assert.throws(() => managed.runtime.acknowledge(['unsettled']), error => error instanceof Error && 'code' in error && error.code === 'unavailable');
  assert.equal(await managed.runtime.settle(), false);
  assert.equal((await managed.diagnostics(scope.signal)).pendingDecision, true);
  assert.equal(current.started.length, 0); assert.deepEqual(current.delivered, []);
  assert.equal(managed.runtime.sessionId, 'exact-history');
});

test('a permanent native disconnect closes its exact generation without an automatic restart', async scope => {
  for (const reason of [Object.assign(new Error('Native authorization denied'), { code: 'forbidden' }),
    new DOMException('Native transport policy denied', 'SecurityError')]) {
    const fixture_ = fixture();
    const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    fixture_.started[0]!.abort(reason); await until(() => fixture_.closed.length === 1); await yieldLoop();
    assert.equal(fixture_.started.length, 1); assert.equal(managed.nativeState().phase, 'failed');
    assert.equal(managed.runtime.sessionId, 'exact-history'); assert.deepEqual(fixture_.failures, [reason]);
    assert.equal(fixture_.recovered(), 1);
  }
});

test('all native activity, unresolved decisions, pending listener work and unknown inspection veto sleep', async scope => {
  for (const condition of ['busy', 'decisions', 'pending', 'unknown'] as const) {
    const fixture_ = fixture();
    const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    fixture_.setBusy(condition === 'busy'); fixture_.setDecisions(condition === 'decisions'); fixture_.setPending(condition === 'pending'); fixture_.setUnknown(condition === 'unknown');
    await fixture_.advance(1800000);
    assert.equal(fixture_.closed.length, 0, condition); assert.equal(managed.nativeState().phase, 'running', condition);
    if (condition === 'unknown') {
      assert.equal(fixture_.failures.length, 1);
      assert(fixture_.observed.some(event => event.kind === 'state' && event.observation.state === 'unavailable'));
      await fixture_.advance(1800000); assert.equal(fixture_.failures.length, 1, 'Unknown inspection is one owner incident, not a notice flood');
    }
    fixture_.setBusy(false); fixture_.setDecisions(false); fixture_.setPending(false); fixture_.setUnknown(false);
    await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
  }
});

test('unacknowledged publication vetoes sleep; canceled unreceived input does not leave a false permanent busy flag', async scope => {
  const fixture_ = fixture();
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  await managed.runtime.deliver('One', 'one'); await fixture_.advance(1800000);
  assert.equal(fixture_.closed.length, 0); managed.runtime.acknowledge(['one']);
  assert.equal(await managed.runtime.recover('Not received', 'unreceived'), false);
  await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
});

test('native crash closes its failed generation and waits for actual input without changing history', async scope => {
  const current = fixture(), managed = value(await initializedLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  current.started[0]!.abort(new Error('Native crash'));
  await until(() => current.closed.length === 1);
  await current.advance(3600000);
  assert.equal(current.started.length, 1); assert.deepEqual(current.delivered, []);
  assert.equal(managed.runtime.signal.aborted, false); assert.equal(managed.runtime.sessionId, 'exact-history');
  assert.equal(current.failures.length, 1); assert.equal(current.recovered(), 1);
  await managed.runtime.deliver('Actual new work', 'after-crash'); managed.runtime.acknowledge(['after-crash']);
  assert.equal(current.started.length, 2); assert.deepEqual(current.delivered, ['after-crash']);
});

test('idle inspection cannot close a generation after new input arrives; zero disables idle sleep', async scope => {
  const fixture_ = fixture();
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  let release!: (value: { busy: boolean }) => void;
  fixture_.setInspect(() => new Promise(resolve => { release = resolve; }));
  await fixture_.advance(1800000); assert.equal(typeof release, 'function');
  await managed.runtime.deliver('Raced input', 'race'); managed.runtime.acknowledge(['race']);
  release({ busy: false }); await yieldLoop(); assert.equal(fixture_.closed.length, 0);
  managed.runtime.lifecycle!.configureIdle(0); fixture_.setInspect(undefined);
  await fixture_.advance(180000000); assert.equal(fixture_.closed.length, 0); assert.equal(fixture_.timers(), 0);
});

test('input and timeout changes during saved-context inspection veto native shutdown', async scope => {
  for (const action of ['input', 'disable'] as const) {
    const fixture_ = fixture();
    const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    let finish!: () => void, inspecting = false;
    fixture_.services.saved = async () => {
      inspecting = true; await new Promise<void>(resolve => { finish = resolve; }); return success(fixture_.saved);
    };
    await fixture_.advance(1800000); await until(() => inspecting);
    if (action === 'input') { await managed.runtime.deliver('New work', 'race-saved'); managed.runtime.acknowledge(['race-saved']); }
    else managed.runtime.lifecycle!.configureIdle(0);
    finish(); await yieldLoop(); await yieldLoop();
    assert.equal(fixture_.closed.length, 0, action); assert.equal(managed.nativeState().phase, 'running', action);
  }
});

test('an idle inspection canceled by intentional shutdown produces no owner failure incident', async () => {
  const fixture_ = fixture();
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal));
  let reject!: (error: Error) => void, inspecting = false;
  fixture_.setInspect(async () => { inspecting = true; return new Promise((_, fail) => { reject = fail; }); });
  await fixture_.advance(1800000); await until(() => inspecting);
  await managed.close(); reject(new Error('Native history owner stopped'));
  await yieldLoop(); assert.equal(fixture_.failures.length, 0); assert.equal(fixture_.closed.length, 1);
});

test('missing history and a resume with a different identity fail closed without implicit fresh context', async () => {
  const fixture_ = fixture(); fixture_.services.allowNewHistory = false; fixture_.saved.length = 0;
  const missing = await initializedLifecycle(fixture_.services, new AbortController().signal);
  assert.equal(missing.ok, false); assert.equal(fixture_.started.length, 0);
  const changed = fixture();
  const start = changed.services.start;
  changed.services.start = async (...input) => { const result = await start(...input); return result.ok ? success({ ...result.value, sessionId: 'different-history' }) : result; };
  const managed = value(await lazyLifecycle(changed.services, new AbortController().signal));
  try { await assert.rejects(managed.runtime.deliver('Wake', 'wrong-history'), /different native history/); }
  finally { await managed.close(); }
  assert.equal(changed.closed.length, 1); assert.deepEqual(changed.delivered, []);
});

test('a crashed generation remains retryable even when recovery has already detached it', async scope => {
  const fixture_ = fixture(), start = fixture_.services.start;
  fixture_.services.start = async (...input) => {
    const result = await start(...input);
    if (!result.ok || fixture_.started.length > 1) return result;
    return success({ ...result.value, deliver: async () => {
      fixture_.started[0]!.abort(new Error('Native transport lost'));
      await yieldLoop();
      throw new Error('Original native request failed');
    } });
  };
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  await assert.rejects(managed.runtime.deliver('One', 'one'), error => error instanceof Error && 'code' in error && error.code === 'unavailable');
  await until(() => fixture_.closed.length === 1);
  assert.equal(fixture_.started.length, 1);
  assert.equal(await managed.runtime.recover('One', 'one'), false);
  await managed.runtime.deliver('One', 'one'); managed.runtime.acknowledge(['one']);
  assert.deepEqual(fixture_.delivered, ['one']); assert.equal(managed.runtime.signal.aborted, false);
});

test('failed cleanup of a rejected startup cannot open a competing native generation', async () => {
  const current = fixture(), start = current.services.start;
  current.services.start = async (...input) => {
    const started = await start(...input);
    return started.ok ? success({ ...started.value, sessionId: 'wrong-history',
      close: async () => { throw new Error('Controlled rejected-startup cleanup failure'); } }) : started;
  };
  const managed = value(await lazyLifecycle(current.services, new AbortController().signal));
  try {
    for (const id of ['rejected', 'blocked-replacement']) {
      await assert.rejects(managed.runtime.deliver('Must retain exact ownership', id), /cleanup failed/);
    }
    assert.equal(current.started.length, 1);
    assert.equal(current.delivered.length, 0);
    assert.equal(managed.runtime.sessionId, 'exact-history');
  } finally { await assert.rejects(managed.close(), /cleanup failed/); }
});

test('input racing with native cleanup observes sleeping before waking and resumes only after cleanup', async scope => {
  const fixture_ = fixture(), start = fixture_.services.start;
  let finish!: () => void, closing = false;
  fixture_.services.start = async (...input) => {
    const result = await start(...input);
    if (!result.ok || fixture_.started.length > 1) return result;
    return success({ ...result.value, close: async () => {
      closing = true;
      await new Promise<void>(resolve => { finish = resolve; });
      await result.value.close();
    } });
  };
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  await fixture_.advance(1800000); await until(() => closing);
  await assert.rejects(managed.runtime.turnControl!.activeTurn(undefined, { priority: 'steering', signal: new AbortController().signal }),
    error => error instanceof Error && 'code' in error && error.code === 'unavailable');
  assert.equal(fixture_.started.length, 1, 'Immediate admission cannot wait behind cleanup or create a competing native owner');
  const delivered = managed.runtime.deliver('Raced input', 'race');
  await yieldLoop(); assert.equal(fixture_.started.length, 1);
  finish(); await delivered; managed.runtime.acknowledge(['race']);
  assert.equal(managed.nativeState().phase, 'running');
  const states = fixture_.observed.flatMap(event => event.kind === 'state' ? [event.observation.state] : []);
  assert.deepEqual(states.slice(-3), ['sleeping', 'waking', 'idle']);
});

test('unverified process cleanup blocks replacement rather than risking duplicate native owners', async () => {
  const fixture_ = fixture(), start = fixture_.services.start;
  fixture_.services.start = async (...input) => {
    const result = await start(...input);
    return result.ok ? success({ ...result.value, close: async () => { throw new Error('Could not terminate native process'); } }) : result;
  };
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal));
  await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'failed');
  await assert.rejects(managed.runtime.deliver('One', 'one'), error => error instanceof Error && 'code' in error && error.code === 'conflict');
  assert.equal(fixture_.started.length, 1); assert.equal(fixture_.failures.length, 1);
  await assert.rejects(managed.close(), /cleanup failed/);
});

test('a selected room defaults native turn inspection to that room while preserving an explicit room override', async scope => {
  const current = fixture(), start = current.services.start, room = '!selected:test';
  current.saved.push({ context: roomContext(room), runtime: 'fixture', sessionId: 'selected-history', workspace: '/fixture' });
  const captured: (string | undefined)[] = [];
  current.services.start = async (...input) => {
    const result = await start(...input); if (!result.ok) return result;
    result.value.turnControl.activeTurn = async requested => { captured.push(requested); return null; };
    result.value.conversation = async () => ({ ...result.value, sessionId: 'selected-history' });
    return result;
  };
  const managed = value(await initializedLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  const selected = await managed.runtime.conversation!(room);
  await selected.turnControl!.activeTurn(); await selected.turnControl!.activeTurn('!explicit:test');
  await managed.runtime.turnControl!.activeTurn();
  assert.deepEqual(captured, [room, '!explicit:test', undefined]);
});


test('100 saved agents stay lazy across repeated listener restoration, inspections and unanswered decisions', async scope => {
  const fixtures = Array.from({ length: 100 }, fixture);
  for (let restart = 0; restart < 3; restart++) {
    const managed = await Promise.all(fixtures.map(async current => {
      current.setDecisions(true);
      return value(await lazyLifecycle(current.services, scope.signal));
    }));
    try {
      for (const owner of managed) {
        await owner.contexts(); await owner.diagnostics(scope.signal); await owner.runtime.inspect();
        await owner.runtime.settle(); owner.runtime.acknowledge([]); await owner.activate();
        assert.equal(owner.nativeState().phase, 'sleeping');
      }
      if (restart === 2) {
        await managed[37]!.runtime.deliver('Authorized input for this agent only', 'selected');
        managed[37]!.runtime.acknowledge(['selected']);
        assert.equal(managed[37]!.runtime.sessionId, 'exact-history');
      }
      assert.equal(fixtures.reduce((sum, current) => sum + current.started.length, 0), restart === 2 ? 1 : 0);
      assert.equal(fixtures.reduce((sum, current) => sum + current.delivered.length, 0), restart === 2 ? 1 : 0);
    } finally { await Promise.all(managed.map(owner => owner.close())); }
  }
});


test('genuine receipt retirement remains fenced until message-driven native initialization completes', async scope => {
  const current = fixture(), managed = value(await lazyLifecycle(current.services, scope.signal));
  scope.after(() => managed.close());
  let entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  current.setSettle(async () => { entered = true; await barrier; return false; });
  const delivery = managed.runtime.deliver('Actual input', 'real-message');
  await until(() => entered);
  assert.throws(() => managed.runtime.acknowledge(['real-message']), error => error instanceof Error && 'code' in error && error.code === 'unavailable');
  assert.deepEqual(current.acknowledged, []); assert.deepEqual(current.delivered, []);
  release(); await delivery; managed.runtime.acknowledge(['real-message']);
  assert.deepEqual(current.delivered, ['real-message']); assert.deepEqual(current.acknowledged, ['real-message']);
  assert.equal(current.started.length, 1);
});
