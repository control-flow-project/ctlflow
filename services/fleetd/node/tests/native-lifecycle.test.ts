import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { success, failure, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';
import type { ResumeWork } from '@ctlflow/fleetd-domain/resume-work';
import type { InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
async function initializedLifecycle(...input: Parameters<typeof createNativeLifecycle>): Promise<Awaited<ReturnType<typeof createNativeLifecycle>>> {
  const started = await createNativeLifecycle(...input);
  if (started.ok) await started.value.activate();
  return started;
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!predicate()) { assert(performance.now() < deadline, 'Native lifecycle observation deadline'); await yieldLoop(); }
}
function fixture() {
  let work: ResumeWork[] = [], sequence = 0;
  let now = 1000, timerId = 0, busy = false, unknown = false, pending = false, decisions = false;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = { now: () => now, deadline: () => new AbortController().signal,
    schedule(callback, milliseconds) { const id = ++timerId; timers.set(id, { at: now + milliseconds, callback }); return () => { timers.delete(id); }; },
    delay: async (_milliseconds, signal) => { signal.throwIfAborted(); },
  };
  const saved: SavedRuntimeContext[] = [{ context: 'shared', runtime: 'fixture', sessionId: 'exact-history', workspace: '/fixture' }];
  const started: AbortController[] = [], closed: string[] = [], delivered: string[] = [], failures: unknown[] = [], observed: RuntimeObservationEvent[] = [];
  const nativeObservers: NonNullable<NativeLifecycleServices['hooks']['observe']>[] = [];
  let recovered = 0, inspect: (() => Promise<{ busy: boolean }>) | undefined;
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'fixture', approval: 'none', initialSettings: [], initial: 'running',
    work: { read: () => success(work.map(item => ({ ...item }))),
      capture: contexts => { for (const context of contexts) if (!work.some(item => item.context === context.context)) work.push({ ...context,
        messageId: '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0'), checkpointedAt: now }); return success(undefined); },
      renew: messageId => {
        const index = work.findIndex(item => item.messageId === messageId);
        if (index < 0) return failure('conflict', 'Checkpoint changed before resume');
        const renewed = { ...work[index]!, messageId: '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0'), checkpointedAt: now };
        work[index] = renewed; return success(renewed);
      },
      clear: contexts => { const selected = new Map(contexts.map(item => [item.context, item.sessionId])); work = work.filter(item => selected.get(item.context) !== item.sessionId); return success(undefined); } },
    hooks: { requestDecision: async () => failure('forbidden', 'Unexpected decision'), pendingInput: () => pending,
      pendingDecisions: () => decisions, observe: event => observed.push(event) },
    saved: async () => success(saved), failed: (_session, error) => failures.push(error), recovered: () => { recovered++; },
    start: async (_signal, observe) => {
      nativeObservers.push(observe);
      const stop = new AbortController(); started.push(stop);
      const context = saved.find(context => context.context === 'shared')!;
      observe({ kind: 'state', observation: { runtime: 'fixture', sessionId: context.sessionId, roomId: null, state: 'idle', observedAt: now, settings: [], errorMessage: null } });
      const connection: OwnedRuntimeConnection = { sessionId: context.sessionId, signal: stop.signal, approval: 'none',
        attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} },
        attachments: async () => saved.map(context => ({ context: context.context, attachment: { runtime: 'fixture', sessionId: context.sessionId, workspace: '/fixture', connection: {} } })),
        inspect: () => inspect ? inspect() : unknown ? Promise.reject(new Error('Unknown native status')) : Promise.resolve({ busy }),
        activity: async () => { const status = await connection.inspect(); return { ...status, contexts: saved.map(item => ({ context: item.context, sessionId: item.sessionId, busy: status.busy })) }; },
        deliver: async (_text, messageId) => { delivered.push(messageId); }, recover: async (_text, messageId) => delivered.includes(messageId),
        acknowledge: () => {}, settle: async () => false, turnControl: { activeTurn: async () => null, interrupt: async () => 'inactive' },
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
  return { services, advance, started, saved, closed, delivered, failures, observed, nativeObservers,
    setBusy: (value: boolean) => { busy = value; }, setUnknown: (value: boolean) => { unknown = value; },
    setPending: (value: boolean) => { pending = value; }, setDecisions: (value: boolean) => { decisions = value; },
    setInspect: (value: typeof inspect) => { inspect = value; }, recovered: () => recovered, timers: () => timers.size };
}

test('opened native generation stays waking and cannot report recovery until listener activation', async scope => {
  const current = fixture(), managed = value(await createNativeLifecycle(current.services, scope.signal));
  scope.after(() => managed.close());
  managed.runtime.lifecycle!.configureIdle(1800);
  assert.equal(managed.nativeState().phase, 'waking'); assert.equal(current.recovered(), 0);
  assert.equal(current.started.length, 1);
  assert(current.observed.every(event => event.kind !== 'state' || event.observation.state === 'waking'));
  await managed.activate();
  assert.equal(managed.nativeState().phase, 'running'); assert.equal(current.recovered(), 1);
  assert(current.observed.some(event => event.kind === 'state' && event.observation.state === 'idle'));
  await managed.activate(); assert.equal(current.recovered(), 1);
});

test('sleeping mention capture uses immediate admission and retained history without a dummy model input', async scope => {
  const current = fixture(), stop = new AbortController(), deadline = new AbortController();
  const admission: InputAdmission = { priority: 'steering', signal: deadline.signal };
  let received: InputAdmission | undefined;
  const start = current.services.start;
  const managed = value(await initializedLifecycle({ ...current.services, initial: 'sleeping', start: async (signal, observe, requested) => {
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
  const managed = value(await initializedLifecycle({ ...current.services, initial: 'sleeping', start: async (signal, observe, requested) => {
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
  const managed = value(await initializedLifecycle({ ...current.services, initial: 'sleeping', start: async (signal, observe, requested) =>
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

test('continuation waits for listener readiness and concurrent input cannot overtake activation', async scope => {
  const current = fixture();
  value(current.services.work.capture([{ context: 'shared', sessionId: 'exact-history' }]));
  const checkpoint = value(current.services.work.read()), start = current.services.start;
  let finish!: () => void, continuing = false;
  current.services.start = async (...input) => {
    const started = await start(...input); if (!started.ok) return started;
    const deliver = started.value.deliver;
    started.value.deliver = async (...input) => {
      if (input[0].startsWith('[Crossfire session restarted]')) { continuing = true; await new Promise<void>(resolve => { finish = resolve; }); }
      return deliver(...input);
    };
    return started;
  };
  const managed = value(await createNativeLifecycle(current.services, new AbortController().signal)); scope.after(() => managed.close());
  assert.deepEqual(current.delivered, []); assert.deepEqual(value(current.services.work.read()), checkpoint, 'Startup idle cannot erase pending continuation');
  const activating = managed.activate(); await until(() => continuing);
  const message = managed.runtime.deliver('New authorized input', 'after-readiness'); await yieldLoop();
  assert.deepEqual(current.delivered, [], 'Input waits for the one activation initialization'); finish();
  await activating; await message; managed.runtime.acknowledge(['after-readiness']); await managed.activate();
  assert.deepEqual(current.delivered, [value(current.services.work.read())[0]!.messageId, 'after-readiness']); assert.equal(current.started.length, 1);
});

test('interrupted work and pending decisions survive stop and receive one continuation in the exact saved history', async scope => {
  for (const state of ['working', 'waiting-answer', 'waiting-approval'] as const) {
    const current = fixture();
    let managed = value(await initializedLifecycle(current.services, new AbortController().signal)); scope.after(() => managed.close());
    const observation = { runtime: 'fixture', sessionId: 'exact-history', roomId: null, state, observedAt: 1000, settings: [], errorMessage: null };
    current.nativeObservers[0]!({ kind: 'state', observation });
    current.setBusy(true);
    const checkpoint = value(current.services.work.read()); assert.equal(checkpoint.length, 1);
    current.nativeObservers[0]!({ kind: 'state', observation }); assert.deepEqual(value(current.services.work.read()), checkpoint);
    await managed.close(); current.services.initial = 'sleeping';
    assert.deepEqual(value(current.services.work.read()), checkpoint, 'A shutdown retains its interrupted native task');
    managed = value(await initializedLifecycle(current.services, new AbortController().signal));
    assert.equal(managed.runtime.sessionId, 'exact-history'); assert.equal(managed.nativeState().phase, 'running');
    assert.deepEqual(current.delivered, [value(current.services.work.read())[0]!.messageId]); assert.equal(value(current.services.work.read()).length, 1);
    assert.notEqual(value(current.services.work.read())[0]!.messageId, checkpoint[0]!.messageId, 'A resumed task retains another durable restart identity');
    value(await managed.resume()); assert.equal(current.delivered.length, 1, 'Repeated resume does not send another task instruction');
    assert.equal(current.started.length, 2);
  }
});

test('completed work clears its checkpoint and sleeping restoration has no synthetic model input', async scope => {
  const current = fixture(); let managed = value(await initializedLifecycle(current.services, new AbortController().signal)); scope.after(() => managed.close());
  const observation = { runtime: 'fixture', sessionId: 'exact-history', roomId: null, observedAt: 1000, settings: [], errorMessage: null };
  current.nativeObservers[0]!({ kind: 'state', observation: { ...observation, state: 'working' } }); assert.equal(value(current.services.work.read()).length, 1);
  current.nativeObservers[0]!({ kind: 'state', observation: { ...observation, state: 'idle' } });
  assert.equal(value(current.services.work.read()).length, 1, 'An idle notification alone cannot erase submitted work');
  assert.equal((await managed.runtime.inspect()).busy, false); assert.deepEqual(value(current.services.work.read()), []);
  await managed.close(); current.services.initial = 'sleeping'; managed = value(await initializedLifecycle(current.services, new AbortController().signal));
  assert.equal(current.started.length, 1); assert.equal(managed.nativeState().phase, 'sleeping'); assert.deepEqual(current.delivered, []);
});

test('incoming messages wait for restored continuation initialization instead of overtaking it', async scope => {
  const current = fixture(); current.services.initial = 'sleeping';
  const managed = value(await initializedLifecycle(current.services, new AbortController().signal)); scope.after(() => managed.close());
  value(current.services.work.capture([{ context: 'shared', sessionId: 'exact-history' }]));
  let release!: () => void, continuing = false;
  const start = current.services.start;
  current.services.start = async (...input) => {
    const started = await start(...input); if (!started.ok) return started;
    const deliver = started.value.deliver;
    started.value.deliver = async (...input) => {
      if (input[0].startsWith('[Crossfire session restarted]')) { continuing = true; await new Promise<void>(resolve => { release = resolve; }); }
      return deliver(...input);
    };
    return started;
  };
  const resuming = managed.resume(); await until(() => continuing);
  const message = managed.runtime.deliver('New authorized input', 'new-input'); await yieldLoop();
  assert.deepEqual(current.delivered, [], 'No input can use a half-initialized generation'); release();
  value(await resuming); await message; managed.runtime.acknowledge(['new-input']);
  assert.equal(current.delivered.length, 2); assert.equal(current.delivered[1], 'new-input');
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
  const fixture_ = fixture(); fixture_.services.initial = 'sleeping';
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  value(await managed.resume()); value(await managed.resume());
  assert.equal(fixture_.started.length, 1); assert.deepEqual(fixture_.delivered, []);
  assert.equal(value(await managed.attachment()).sessionId, 'exact-history');
  assert.equal(managed.nativeState().phase, 'running'); assert.equal(managed.runtime.signal.aborted, false);
});

test('recovery binds sleeping histories without a process and concurrent inputs share one native generation', async scope => {
  const fixture_ = fixture(); fixture_.services.initial = 'sleeping';
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal));
  scope.after(() => managed.close());
  assert.equal(fixture_.started.length, 0); assert.equal(managed.nativeState().historyAvailable, true);
  assert.equal(managed.runtime.approval, 'none');
  await Promise.all([managed.runtime.deliver('One', 'one'), managed.runtime.deliver('Two', 'two')]);
  managed.runtime.acknowledge(['one', 'two']);
  assert.equal(fixture_.started.length, 1); assert.deepEqual(fixture_.delivered.toSorted(), ['one', 'two']);
});

test('empty receipt checkpoints settle while sleeping without waking native history; real receipts remain fenced', async scope => {
  for (const initial of ['running', 'sleeping'] as const) {
    const fixture_ = fixture(); fixture_.services.initial = initial;
    const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    if (initial === 'running') { await fixture_.advance(1800000); await until(() => managed.nativeState().phase === 'sleeping'); }
    const starts = fixture_.started.length;
    assert.doesNotThrow(() => managed.runtime.acknowledge([]), initial);
    assert.throws(() => managed.runtime.acknowledge(['unsettled']), error => error instanceof Error && 'code' in error && error.code === 'unavailable');
    assert.equal(fixture_.started.length, starts); assert.equal(managed.nativeState().phase, 'sleeping');
    assert.equal(managed.runtime.signal.aborted, false); assert.equal(managed.runtime.sessionId, 'exact-history');
  }
});

test('native recovery retries transport cancellation during resume without replacing saved history', async scope => {
  for (const reason of [new DOMException('Transport canceled', 'AbortError'), Object.assign(new Error('Transport canceled'), { code: 'ABORT_ERR' })]) {
    const fixture_ = fixture(), start = fixture_.services.start;
    let attempts = 0;
    fixture_.services.start = async (...input) => {
      if (++attempts === 2) throw reason;
      return start(...input);
    };
    const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
    fixture_.started[0]!.abort(new Error('Native transport disconnected'));
    await until(() => managed.nativeState().phase === 'running' && attempts === 3);
    assert.equal(fixture_.started.length, 2); assert.equal(managed.runtime.sessionId, 'exact-history');
    assert.equal(managed.runtime.signal.aborted, false); assert.equal(fixture_.failures.length, 1);
  }
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

test('native crash is reported and recovered without disconnecting the listener or changing history', async scope => {
  const fixture_ = fixture();
  const managed = value(await initializedLifecycle(fixture_.services, new AbortController().signal)); scope.after(() => managed.close());
  fixture_.started[0]!.abort(new Error('Native crash'));
  await until(() => fixture_.started.length === 2 && managed.nativeState().phase === 'running');
  assert.equal(managed.runtime.signal.aborted, false); assert.equal(managed.runtime.sessionId, 'exact-history');
  assert.equal(fixture_.failures.length, 1); assert.equal(fixture_.recovered(), 2);
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
  const fixture_ = fixture(); fixture_.services.initial = 'sleeping'; fixture_.saved.length = 0;
  const missing = await initializedLifecycle(fixture_.services, new AbortController().signal);
  assert.equal(missing.ok, false); assert.equal(fixture_.started.length, 0);
  const changed = fixture();
  const start = changed.services.start;
  changed.services.start = async (...input) => { const result = await start(...input); return result.ok ? success({ ...result.value, sessionId: 'different-history' }) : result; };
  const result = await initializedLifecycle(changed.services, new AbortController().signal);
  assert.equal(result.ok, false); assert.equal(result.ok ? null : result.error.code, 'conflict'); assert.equal(changed.closed.length, 1);
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
  await until(() => managed.nativeState().phase === 'running' && fixture_.started.length === 2);
  assert.equal(await managed.runtime.recover('One', 'one'), false);
  await managed.runtime.deliver('One', 'one'); managed.runtime.acknowledge(['one']);
  assert.equal(fixture_.delivered.length, 2); assert.equal(fixture_.delivered[1], 'one');
  assert(fixture_.delivered[0]!.startsWith('00000000-0000-4000-8000-')); assert.equal(managed.runtime.signal.aborted, false);
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

test('submission persists unfinished work before entering the native adapter without waiting for an observation', async scope => {
  const current = fixture(), start = current.services.start;
  current.services.start = async (...input) => {
    const result = await start(...input); if (!result.ok) return result;
    return success({ ...result.value, deliver: async (_text, messageId) => {
      const pending = value(current.services.work.read());
      assert.equal(pending.length, 1); assert.equal(pending[0]!.context, 'shared'); assert.equal(pending[0]!.sessionId, 'exact-history');
      current.delivered.push(messageId);
    } });
  };
  const managed = value(await initializedLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  await managed.runtime.deliver('Write before native I/O', 'write-ahead');
  assert.deepEqual(current.delivered, ['write-ahead']);
  assert.equal(value(current.services.work.read()).length, 1);
  managed.runtime.acknowledge(['write-ahead']);
  assert.equal((await managed.runtime.inspect()).busy, false); assert.deepEqual(value(current.services.work.read()), []);
});

test('a delayed idle notification and an older native query cannot erase a newer submitted task', async scope => {
  const current = fixture(), managed = value(await initializedLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  await managed.runtime.deliver('First task', 'first'); managed.runtime.acknowledge(['first']);
  current.setBusy(true);
  current.nativeObservers[0]!({ kind: 'state', observation: { runtime: 'fixture', sessionId: 'exact-history', roomId: null,
    state: 'idle', observedAt: 1000, settings: [], errorMessage: null } });
  assert.equal((await managed.runtime.inspect()).busy, true); assert.equal(value(current.services.work.read()).length, 1);
  let release!: (status: { busy: boolean }) => void;
  current.setInspect(() => new Promise(resolve => { release = resolve; }));
  const older = managed.runtime.inspect(); await until(() => typeof release === 'function');
  await managed.runtime.deliver('Newer task', 'newer'); managed.runtime.acknowledge(['newer']);
  release({ busy: false }); await older;
  assert.equal(value(current.services.work.read()).length, 1, 'A query that began before newer input cannot establish its completion');
  current.setInspect(undefined); assert.equal((await managed.runtime.inspect()).busy, true);
  current.setBusy(false); assert.equal((await managed.runtime.inspect()).busy, false); assert.deepEqual(value(current.services.work.read()), []);
});

test('failed write-ahead persistence prevents any native submission', async scope => {
  const current = fixture(), managed = value(await initializedLifecycle(current.services, scope.signal)); scope.after(() => managed.close());
  current.services.work.capture = () => failure('unavailable', 'Controlled write-ahead failure');
  await assert.rejects(managed.runtime.deliver('Must not reach native input', 'blocked'), /Controlled write-ahead failure/);
  assert.deepEqual(current.delivered, []); assert.equal(managed.runtime.signal.aborted, false);
});

test('inspection and stop clear a completed room without clearing another room with unacknowledged input', async scope => {
  for (const action of ['inspect', 'stop', 'stop-during-inspection']) {
    const current = fixture(), start = current.services.start;
    const rooms = ['!active:test', '!completed:test'].map((context, index) => ({ context, runtime: 'fixture', sessionId: 'room-history-' + index, workspace: '/fixture' }));
    current.saved.push(...rooms);
    const busy = new Map(rooms.map(item => [item.context, false]));
    let holdInspection = false, inspecting = false, release: (() => void) | undefined;
    let older: Promise<{ busy: boolean }> | undefined;
    current.services.start = async (...input) => {
      const result = await start(...input); if (!result.ok) return result;
      const root = result.value;
      root.activity = async () => {
        const snapshot = { busy: [...busy.values()].some(Boolean), contexts: current.saved.map(item => ({
          context: item.context, sessionId: item.sessionId, busy: busy.get(item.context) ?? false })) };
        if (holdInspection) { holdInspection = false; inspecting = true; await new Promise<void>(resolve => { release = resolve; }); }
        return snapshot;
      };
      root.conversation = async room => {
        const saved = rooms.find(item => item.context === room)!;
        return { ...root, sessionId: saved.sessionId, deliver: async () => { busy.set(room, true); } };
      };
      return result;
    };
    const managed = value(await initializedLifecycle(current.services, scope.signal));
    try {
      const completed = await managed.runtime.conversation!(rooms[1]!.context);
      await completed.deliver('Complete this room task', 'completed'); completed.acknowledge(['completed']); busy.set(rooms[1]!.context, false);
      const active = await managed.runtime.conversation!(rooms[0]!.context);
      await active.deliver('Keep this room task pending', 'active');
      assert.equal(value(current.services.work.read()).length, 2);
      if (action === 'stop-during-inspection') {
        holdInspection = true; older = managed.runtime.inspect(); await until(() => inspecting);
      }
      if (action === 'inspect') assert.equal((await managed.runtime.inspect()).busy, true);
      else await managed.close();
      release?.(); await older;
      assert.deepEqual(value(current.services.work.read()).map(item => item.context), [rooms[0]!.context], 'Only the unfinished exact room can receive a later restart reminder');
    } finally { release?.(); await older; await managed.close(); }
  }
});

test('a selected room defaults native turn inspection to that room while preserving an explicit room override', async scope => {
  const current = fixture(), start = current.services.start, room = '!selected:test';
  current.saved.push({ context: room, runtime: 'fixture', sessionId: 'selected-history', workspace: '/fixture' });
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
