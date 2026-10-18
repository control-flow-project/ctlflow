import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeDelivery, type NativeMessage, type NativeReceipt } from '@ctlflow/crossfire-adapter-runtime/delivery';
import { deliveryText, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeHooks, RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import { failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { createResumeWork } from '@ctlflow/fleetd-storage/resume-work';
import { resumeInterruptedWork } from '@ctlflow/fleetd-domain/resume-work';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
const input = check.object({ text: deliveryText, messageId: check.text(200) });

async function fixture(scope: TestContext, originalReceipt: NativeReceipt = true, context = 'shared') {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-receipt-order-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const sessionId = randomUUID(), journal = join(directory, 'receipt.json');
  const original = { text: 'Attributed pending @mention', messageId: randomUUID() };
  const store = createResumeWork(directory, () => 1000);
  const roomId = context === 'shared' || context === 'control' ? null : context;
  const contexts: SavedRuntimeContext[] = [{ context, sessionId, runtime: 'fixture', workspace: directory }];
  const submitted: NativeMessage[] = [], order: string[] = [];
  let loseResponse = true;
  let receipt: (message: NativeMessage) => Promise<NativeReceipt> = async message => message.messageId === original.messageId ? originalReceipt : true;
  function open(signal: AbortSignal, observe?: NonNullable<RuntimeHooks['observe']>): OwnedRuntimeConnection {
    const delivery = nativeDelivery({ sessionId, approval: 'none', signal, verify: () => {}, inspect: async () => ({ busy: false }),
      prepare: (text, messageId) => ({ text, messageId }),
      publish: message => {
        submitted.push({ ...message }); order.push('publish:' + message.messageId);
        observe?.({ kind: 'state', observation: { sessionId, roomId, runtime: 'fixture', state: 'working', observedAt: 1000, settings: [], errorMessage: null } });
        if (loseResponse) { loseResponse = false; throw new Error('Controlled connection loss after native submission'); }
      },
      received: async message => { order.push('receipt:' + message.messageId); return receipt(message); },
      close: () => {},
    }, input, { journal, pollMs: 100 });
    observe?.({ kind: 'state', observation: { sessionId, roomId, runtime: 'fixture', state: 'idle', observedAt: 1000, settings: [], errorMessage: null } });
    return { ...delivery, attachment: { runtime: 'fixture', sessionId, workspace: directory, connection: {} }, attachments: async () => [],
      turnControl: { activeTurn: async () => null, interrupt: async () => 'inactive' } };
  }
  const first = open(scope.signal);
  try { await assert.rejects(first.deliver(original.text, original.messageId), /Controlled connection loss/); }
  finally { await first.close(); }
  value(store.capture([{ context, sessionId }]));
  return { sessionId, journal, original, store, contexts, submitted, order, open,
    setReceipt(next: typeof receipt) { receipt = next; } };
}

for (const outcome of [true, 'cancelled', 'interrupted'] as const) {
  test('restart continuation settles its original native publication before new input: ' + outcome, async scope => {
    const current = await fixture(scope, outcome), connection = current.open(scope.signal);
    cleanup(scope, () => connection.close());
    const reminder = value(current.store.read())[0]!;
    await resumeInterruptedWork(connection, 'shared', current.contexts, current.store);
    assert.deepEqual(current.submitted.map(message => message.messageId), [current.original.messageId, reminder.messageId]);
    assert(current.order.indexOf('receipt:' + current.original.messageId) < current.order.indexOf('publish:' + reminder.messageId));
    assert(current.submitted[1]!.text.startsWith('[Crossfire session restarted]'));
    assert.equal(value(current.store.read()).length, 1);
    assert.notEqual(value(current.store.read())[0]!.messageId, reminder.messageId);
    const journal = readDeliveryJournal(current.journal, current.sessionId, input);
    assert.equal(journal.pending, null);
    assert.deepEqual(journal.confirmed.map(message => message.messageId), outcome === true ? [current.original.messageId] : []);
    assert.equal(await connection.recover(current.original.text, current.original.messageId), outcome === true);
  });
}

test('per-room continuations settle only each exact room receipt and retain original control input', async scope => {
  const control = await fixture(scope, true, 'control'), first = await fixture(scope, true, '!first:test'), second = await fixture(scope, true, '!second:test');
  const rooms = new Map([first, second].map(current => [current.contexts[0]!.context, current.open(scope.signal)]));
  const primary = control.open(scope.signal);
  cleanup(scope, async () => { await primary.close(); for (const room of [...rooms.values()].toReversed()) await room.close(); });
  const contexts = [...control.contexts, ...first.contexts, ...second.contexts];
  value(first.store.capture(second.contexts.map(({ context, sessionId }) => ({ context, sessionId }))));
  const checkpoints = value(first.store.read());
  const connection: OwnedRuntimeConnection = { ...primary, conversation: async room => rooms.get(room) ?? assert.fail('Cannot create another room history') };
  await resumeInterruptedWork(connection, 'control', contexts, first.store);
  assert.equal(value(first.store.read()).length, 2);
  assert(value(first.store.read()).every(work => !checkpoints.some(before => before.messageId === work.messageId)), 'Both room tasks remain checkpointed with new restart identities');
  for (const current of [first, second]) {
    const checkpoint = checkpoints.find(work => work.sessionId === current.sessionId)!;
    assert.deepEqual(current.submitted.map(message => message.messageId), [current.original.messageId, checkpoint.messageId]);
    assert(current.order.indexOf('receipt:' + current.original.messageId) < current.order.indexOf('publish:' + checkpoint.messageId));
    assert(current.submitted[1]!.text.includes(current.contexts[0]!.context));
    assert.equal(await rooms.get(current.contexts[0]!.context)!.recover(current.original.text, current.original.messageId), true);
  }
  assert.equal(control.submitted.length, 1);
  assert.equal(readDeliveryJournal(control.journal, control.sessionId, input).pending!.messageId, control.original.messageId);
});

test('unverifiable original input retains both checkpoints and blocks continuation publication', async scope => {
  const current = await fixture(scope), connection = current.open(scope.signal);
  cleanup(scope, () => connection.close());
  const nativeBefore = readFileSync(current.journal), workBefore = value(current.store.read());
  current.setReceipt(async () => { throw failureError({ code: 'unavailable', message: 'Original receipt is temporarily unavailable' }); });
  await assert.rejects(resumeInterruptedWork(connection, 'shared', current.contexts, current.store), /Original receipt is temporarily unavailable/);
  assert.deepEqual(readFileSync(current.journal), nativeBefore);
  assert.equal(value(current.store.read()).length, workBefore.length);
  assert.equal(value(current.store.read())[0]!.sessionId, workBefore[0]!.sessionId);
  assert.notEqual(value(current.store.read())[0]!.messageId, workBefore[0]!.messageId);
  assert.deepEqual(current.submitted.map(message => message.messageId), [current.original.messageId]);
  current.setReceipt(async () => true);
  await resumeInterruptedWork(connection, 'shared', current.contexts, current.store);
  assert.equal(current.submitted.length, 2); assert.equal(value(current.store.read()).length, 1);
});

test('native recovery cannot report success before original receipt and continuation readiness', async scope => {
  const current = await fixture(scope), stop = new AbortController(), observed: RuntimeObservationEvent[] = [];
  let release!: () => void, enter!: () => void, recovered = 0;
  const pending = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  current.setReceipt(async message => {
    if (message.messageId === current.original.messageId) { enter(); await pending; }
    return true;
  });
  const clock: Clock = { now: () => 1000, deadline: () => scope.signal, delay: async (_milliseconds, signal) => { signal.throwIfAborted(); }, schedule: () => () => {} };
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'fixture', approval: 'none', initial: 'sleeping', initialSettings: [],
    work: current.store, saved: async () => success(current.contexts),
    hooks: { requestDecision: async () => success(null), observe: event => observed.push(event) },
    failed: () => {}, recovered: () => { recovered++; },
    start: async (signal, observe) => success(current.open(signal, observe)) };
  const managed = value(await createNativeLifecycle(services, stop.signal));
  cleanup(scope, async () => { release(); stop.abort(); await managed.close(); });
  const activation = managed.activate();
  await Promise.race([entered, activation.then(() => assert.fail('Activation cannot finish before its original receipt'))]);
  assert.equal(managed.nativeState().phase, 'waking'); assert.equal(recovered, 0);
  assert(observed.every(event => event.kind !== 'state' || !['idle', 'working'].includes(event.observation.state)), 'Initialization is not a recovered native generation');
  assert.equal(current.submitted.length, 1);
  release(); await activation;
  assert.equal(managed.nativeState().phase, 'running'); assert.equal(recovered, 1);
  assert(observed.some(event => event.kind === 'state' && event.observation.state === 'working'));
  assert.equal(current.submitted.length, 2);
  assert.equal(await managed.runtime.recover(current.original.text, current.original.messageId), true);
  managed.runtime.acknowledge([current.original.messageId]);
});

test('live turn controls stay available while original saved input is being checked', async scope => {
  const current = await fixture(scope);
  let release!: () => void, enter!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  current.setReceipt(async message => { if (message.messageId === current.original.messageId) { enter(); await pending; } return true; });
  const controls: string[] = [];
  const clock: Clock = { now: () => 1000, deadline: () => scope.signal, delay: async (_milliseconds, signal) => { signal.throwIfAborted(); }, schedule: () => () => {} };
  const managed = value(await createNativeLifecycle({ clock, primary: 'shared', runtime: 'fixture', approval: 'none', initial: 'sleeping', initialSettings: [],
    work: current.store, saved: async () => success(current.contexts), hooks: { requestDecision: async () => success(null) }, failed: () => {}, recovered: () => {},
    start: async (signal, observe) => success({ ...current.open(signal, observe), turnControl: {
      activeTurn: async () => { controls.push('read'); return 'live-turn'; }, interrupt: async turn => { controls.push(turn); return 'interrupted'; },
    } }) }, scope.signal));
  cleanup(scope, async () => { release(); await managed.close(); });
  const activation = managed.activate();
  await entered;
  const admission = { priority: 'steering' as const, signal: scope.signal };
  assert.equal(await managed.runtime.turnControl!.activeTurn(undefined, admission), 'live-turn');
  assert.equal(await managed.runtime.turnControl!.interrupt('live-turn', false, admission), 'interrupted');
  assert.deepEqual(controls, ['read', 'live-turn']);
  assert.equal(managed.nativeState().phase, 'waking'); assert.equal(current.submitted.length, 1);
  release(); await activation;
  assert.equal(managed.nativeState().phase, 'running');
});

test('saved input without unfinished-work checkpoint is settled before the resumed generation is ready', async scope => {
  const current = await fixture(scope), observed: RuntimeObservationEvent[] = [];
  value(current.store.clear());
  let release!: () => void, enter!: () => void, recovered = 0;
  const pending = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  current.setReceipt(async () => { enter(); await pending; return true; });
  const clock: Clock = { now: () => 1000, deadline: () => scope.signal, delay: async (_milliseconds, signal) => { signal.throwIfAborted(); }, schedule: () => () => {} };
  const managed = value(await createNativeLifecycle({ clock, primary: 'shared', runtime: 'fixture', approval: 'none', initial: 'sleeping', initialSettings: [],
    work: current.store, saved: async () => success(current.contexts), hooks: { requestDecision: async () => success(null), observe: event => observed.push(event) },
    failed: () => {}, recovered: () => { recovered++; }, start: async (signal, observe) => success(current.open(signal, observe)) }, scope.signal));
  cleanup(scope, async () => { release(); await managed.close(); });
  await managed.activate();
  const recovering = managed.runtime.recover(current.original.text, current.original.messageId);
  await Promise.race([entered, recovering.then(() => assert.fail('Original settlement cannot finish before its receipt'))]);
  assert.equal(managed.nativeState().phase, 'waking'); assert.equal(recovered, 0);
  assert(observed.every(event => event.kind !== 'state' || event.observation.state !== 'idle'));
  release(); assert.equal(await recovering, true);
  assert.equal(managed.nativeState().phase, 'running'); assert.equal(recovered, 1);
  assert.equal(current.submitted.length, 1); assert.deepEqual(value(current.store.read()), []);
  managed.runtime.acknowledge([current.original.messageId]);
});

test('native generation ending during its continuation cannot report recovery after authoritative receipt', async scope => {
  const current = await fixture(scope), ended = new AbortController(), observed: RuntimeObservationEvent[] = [];
  let recovered = 0;
  current.setReceipt(async message => {
    if (message.messageId !== current.original.messageId) ended.abort(failureError({ code: 'conflict', message: 'Exact generation ended during continuation' }));
    return true;
  });
  const clock: Clock = { now: () => 1000, deadline: () => scope.signal, delay: async (_milliseconds, signal) => { signal.throwIfAborted(); }, schedule: () => () => {} };
  const managed = value(await createNativeLifecycle({ clock, primary: 'shared', runtime: 'fixture', approval: 'none', initial: 'sleeping', initialSettings: [],
    work: current.store, saved: async () => success(current.contexts), hooks: { requestDecision: async () => success(null), observe: event => observed.push(event) },
    failed: () => {}, recovered: () => { recovered++; }, start: async (signal, observe) => success(current.open(AbortSignal.any([signal, ended.signal]), observe)) }, scope.signal));
  cleanup(scope, () => managed.close());
  await assert.rejects(managed.activate(), /Exact generation ended during continuation/);
  assert.equal(managed.nativeState().phase, 'failed'); assert.equal(recovered, 0);
  assert(observed.every(event => event.kind !== 'state' || !['idle', 'working'].includes(event.observation.state)));
  assert.equal(current.submitted.length, 2); assert.equal(value(current.store.read()).length, 1);
});

test('failed native initialization does not report an idle generation as recovered', async scope => {
  const current = await fixture(scope), observed: RuntimeObservationEvent[] = [];
  let recovered = 0;
  current.setReceipt(async () => { throw failureError({ code: 'conflict', message: 'Original native evidence is invalid' }); });
  const clock: Clock = { now: () => 1000, deadline: () => scope.signal, delay: async (_milliseconds, signal) => { signal.throwIfAborted(); }, schedule: () => () => {} };
  const managed = value(await createNativeLifecycle({ clock, primary: 'shared', runtime: 'fixture', approval: 'none', initial: 'sleeping', initialSettings: [],
    work: current.store, saved: async () => success(current.contexts), hooks: { requestDecision: async () => success(null), observe: event => observed.push(event) },
    failed: () => {}, recovered: () => { recovered++; }, start: async (signal, observe) => success(current.open(signal, observe)) }, scope.signal));
  cleanup(scope, () => managed.close());
  await assert.rejects(managed.activate(), /Original native evidence is invalid/);
  assert.equal(managed.nativeState().phase, 'failed'); assert.equal(recovered, 0);
  assert(observed.every(event => event.kind !== 'state' || !['idle', 'working'].includes(event.observation.state)));
  assert(observed.some(event => event.kind === 'state' && event.observation.state === 'failed'));
  assert.equal(current.submitted.length, 1); assert.equal(value(current.store.read()).length, 1);
});
